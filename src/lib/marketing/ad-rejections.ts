import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdRejection, RejectionIssue, RejectionPolicy } from "./launched-creatives";

// Meta's review feedback, kept per ad in fb_ad_rejections. Facebook only
// reports ad_review_feedback while the ad is rejected; once Fix Rejections
// swaps in the safe image and the ad is re-approved, the reason is gone.
// So the first time an ad is seen DISAPPROVED / WITH_ISSUES its feedback is
// written here, and the row outlives the rejection.

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const BATCH = 50;

export const REJECTED_STATUSES = new Set(["DISAPPROVED", "WITH_ISSUES"]);

interface FeedbackNode {
  effective_status?: string;
  ad_review_feedback?: {
    global?: Record<string, string>;
    placement_specific?: Record<string, Record<string, string>>;
  };
  issues_info?: Array<{
    error_code?: number;
    error_message?: string;
    error_summary?: string;
    level?: string;
    error_type?: string;
  }>;
}

export function flattenFeedback(node: FeedbackNode): {
  policies: RejectionPolicy[];
  issues: RejectionIssue[];
} {
  const policies: RejectionPolicy[] = [];
  const arf = node.ad_review_feedback;
  for (const [policy, description] of Object.entries(arf?.global ?? {})) {
    policies.push({ scope: "global", policy, description });
  }
  for (const [placement, byPolicy] of Object.entries(arf?.placement_specific ?? {})) {
    for (const [policy, description] of Object.entries(byPolicy)) {
      policies.push({ scope: placement, policy, description });
    }
  }
  const issues: RejectionIssue[] = (node.issues_info ?? []).map((i) => ({
    level: i.level ?? null,
    type: i.error_type ?? null,
    summary: i.error_summary ?? null,
    message: i.error_message ?? null,
    code: i.error_code ?? null,
  }));
  return { policies, issues };
}

/** Facebook's review feedback for many ads, 50 per call. Missing ids are left out. */
export async function fetchReviewFeedback(
  token: string,
  adIds: string[],
  timeoutMs = 10000
): Promise<Map<string, { status: string | null; policies: RejectionPolicy[]; issues: RejectionIssue[] }>> {
  const out = new Map<string, { status: string | null; policies: RejectionPolicy[]; issues: RejectionIssue[] }>();
  for (let i = 0; i < adIds.length; i += BATCH) {
    const chunk = adIds.slice(i, i + BATCH);
    const params = new URLSearchParams({
      ids: chunk.join(","),
      fields: "effective_status,ad_review_feedback,issues_info",
      access_token: token,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${FB_API_BASE}/?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, FeedbackNode>;
      for (const [id, node] of Object.entries(json)) {
        if (!node || typeof node !== "object") continue;
        out.set(id, { status: node.effective_status ?? null, ...flattenFeedback(node) });
      }
    } catch {
      // One failed batch loses nothing permanent: the next refresh retries.
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export interface SeenAd {
  ad_id: string;
  account_id: string;
  effective_status: string | null;
}

/**
 * Bring fb_ad_rejections in line with what Facebook shows now:
 *  - an ad seen rejected with no row (or a row already cleared) gets its
 *    feedback fetched and stored;
 *  - a stored rejection whose ad is no longer rejected is marked cleared.
 * `db` must be the service client: the tables are read-only for users.
 */
export async function recordRejections(
  db: SupabaseClient,
  token: string,
  ads: SeenAd[]
): Promise<{ recorded: number; cleared: number }> {
  if (ads.length === 0) return { recorded: 0, cleared: 0 };
  const ids = ads.map((a) => a.ad_id);
  const existing = new Map<string, { status: string; cleared_at: string | null; policies: unknown[] }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("fb_ad_rejections")
      .select("ad_id, status, cleared_at, policies")
      .in("ad_id", ids.slice(i, i + 200));
    for (const r of data ?? []) {
      existing.set(r.ad_id as string, {
        status: r.status as string,
        cleared_at: r.cleared_at as string | null,
        policies: (r.policies as unknown[]) ?? [],
      });
    }
  }

  const now = new Date().toISOString();
  const rejectedNow = ads.filter((a) => REJECTED_STATUSES.has((a.effective_status ?? "").toUpperCase()));
  const toFetch = rejectedNow.filter((a) => {
    const row = existing.get(a.ad_id);
    // New rejection, a re-rejection after a clear, a status change, or a row
    // stored before the feedback was readable.
    return !row || row.cleared_at || row.status !== a.effective_status || row.policies.length === 0;
  });

  let recorded = 0;
  if (toFetch.length > 0) {
    const feedback = await fetchReviewFeedback(token, toFetch.map((a) => a.ad_id));
    const base = (a: SeenAd) => {
      const fb = feedback.get(a.ad_id);
      const row = existing.get(a.ad_id);
      return {
        ad_id: a.ad_id,
        account_id: a.account_id,
        status: (fb?.status ?? a.effective_status ?? "DISAPPROVED").toUpperCase(),
        policies: fb?.policies ?? row?.policies ?? [],
        issues: fb?.issues ?? [],
        last_seen_at: now,
        cleared_at: null,
      };
    };
    // A fresh rejection (no row, or a row from an earlier, cleared one)
    // starts its clock now; a status change on a live rejection keeps it.
    // Two upserts because PostgREST wants every row of a batch shaped alike.
    const fresh = toFetch.filter((a) => {
      const row = existing.get(a.ad_id);
      return !row || row.cleared_at;
    });
    const ongoing = toFetch.filter((a) => !fresh.includes(a));
    if (fresh.length > 0) {
      const { error } = await db
        .from("fb_ad_rejections")
        .upsert(fresh.map((a) => ({ ...base(a), first_seen_at: now })), { onConflict: "ad_id" });
      if (!error) recorded += fresh.length;
    }
    if (ongoing.length > 0) {
      const { error } = await db
        .from("fb_ad_rejections")
        .upsert(ongoing.map(base), { onConflict: "ad_id" });
      if (!error) recorded += ongoing.length;
    }
  }

  // Still-rejected rows just get their last_seen_at bumped.
  const stillRejected = rejectedNow
    .filter((a) => !toFetch.includes(a))
    .map((a) => a.ad_id);
  if (stillRejected.length > 0) {
    await db.from("fb_ad_rejections").update({ last_seen_at: now }).in("ad_id", stillRejected);
  }

  const rejectedIds = new Set(rejectedNow.map((a) => a.ad_id));
  const toClear = [...existing.entries()]
    .filter(([id, row]) => !row.cleared_at && !rejectedIds.has(id))
    .map(([id]) => id);
  let cleared = 0;
  if (toClear.length > 0) {
    const { error } = await db
      .from("fb_ad_rejections")
      .update({ cleared_at: now })
      .in("ad_id", toClear);
    if (!error) cleared = toClear.length;
  }
  return { recorded, cleared };
}

/** Stored rejections for a set of ads, keyed by ad id. Works with the session client too. */
export async function loadRejections(
  db: SupabaseClient,
  adIds: string[]
): Promise<Map<string, AdRejection>> {
  const out = new Map<string, AdRejection>();
  for (let i = 0; i < adIds.length; i += 200) {
    const { data } = await db
      .from("fb_ad_rejections")
      .select("ad_id, status, policies, issues, first_seen_at, last_seen_at, cleared_at")
      .in("ad_id", adIds.slice(i, i + 200));
    for (const r of data ?? []) {
      out.set(r.ad_id as string, {
        status: r.status as string,
        policies: (r.policies as RejectionPolicy[]) ?? [],
        issues: (r.issues as RejectionIssue[]) ?? [],
        first_seen_at: r.first_seen_at as string,
        last_seen_at: r.last_seen_at as string,
        cleared_at: (r.cleared_at as string | null) ?? null,
      });
    }
  }
  return out;
}
