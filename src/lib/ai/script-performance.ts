// Aggregates Meta Ads performance across all ads linked to an approved script.
// Pulls from two sources so retroactively-linked ads count toward winner
// detection just like ads created via the bulk-create flow:
//   1. ad_drafts.source_script_id  — implicit link from the bulk-create flow
//   2. ad_approved_script_links    — explicit "Link to Live Ad" tag from
//      the Approved Library, for ads that already existed on Meta
// Same fb_ad_id from both sources is deduped (drafts win, since they carry
// the richer name/status). Reuses the existing daily-insights fetcher and
// winner classifier so the "winner" definition stays identical across the
// platform (CPP<₱200, ≥3 purchases/day, ≥2 consecutive days).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAdDailyInsights,
  classifyConsistency,
  DEFAULT_WINNER_THRESHOLDS,
  type ConsistencyTier,
  type DailyAdMetrics,
  type DailyMetricPoint,
} from "@/lib/facebook/insights-daily";
import type { DatePreset } from "@/lib/facebook/types";

interface AdCreativeAnalysisRow {
  ad_id: string;
  thumbnail_url: string | null;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

export async function loadDeconstructions(
  supabase: SupabaseClient,
  adIds: string[]
): Promise<Map<string, AdDeconstruction>> {
  const out = new Map<string, AdDeconstruction>();
  if (adIds.length === 0) return out;

  const { data, error } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, thumbnail_url, analysis, created_at")
    .in("ad_id", adIds);

  if (error || !data) return out;

  for (const row of data as AdCreativeAnalysisRow[]) {
    const analysis = (row.analysis ?? {}) as Record<string, unknown>;
    out.set(row.ad_id, {
      transcript: (analysis.transcript as string | undefined) ?? null,
      hook: (analysis.hook as string | undefined) ?? null,
      scenes:
        (analysis.scenes as Array<{ t: string; description: string }> | undefined) ??
        null,
      visual_style: (analysis.visual_style as string | undefined) ?? null,
      tone: (analysis.tone as string | undefined) ?? null,
      cta: (analysis.cta as string | undefined) ?? null,
      thumbnail_url: row.thumbnail_url,
      analyzed_at: row.created_at,
    });
  }
  return out;
}

const CONCURRENCY = 4;

export interface AdDeconstruction {
  transcript: string | null;
  hook: string | null;
  scenes: Array<{ t: string; description: string }> | null;
  visual_style: string | null;
  tone: string | null;
  cta: string | null;
  thumbnail_url: string | null;
  analyzed_at: string;
}

export interface AdPerformanceSummary {
  fb_ad_id: string;
  account_id: string | null;
  draft_id: string;
  draft_name: string;
  draft_status: string;
  spend: number;
  purchases: number;
  purchase_value: number;
  cpp: number;
  roas: number;
  tier: ConsistencyTier | "no_data";
  winning_days: number;
  max_consecutive: number;
  daily?: DailyMetricPoint[];
  deconstruction?: AdDeconstruction | null;
}

export interface ScriptPerformance {
  script_id: string;
  // Counts
  draft_count: number;        // any draft with this source_script_id
  submitted_count: number;    // drafts with fb_ad_id (= launched on Meta)
  live_count: number;         // drafts currently in status='submitted'
  // Rolled-up totals across every ad that used this script
  spend: number;
  purchases: number;
  purchase_value: number;
  cpp: number;
  roas: number;
  // The aggregate tier uses a simple escalation: any stable_winner → winner,
  // else any spike → spike, else stable_loser if any purchases, else dead.
  tier: ConsistencyTier | "no_data";
  best_ad: AdPerformanceSummary | null;
  ads?: AdPerformanceSummary[]; // full detail, only on per-script endpoint
}

interface DraftLink {
  id: string;
  name: string;
  status: string;
  fb_ad_id: string | null;
  source_script_id: string;
  fb_ad_account_id: string | null;
  // "draft" rows come from ad_drafts (implicit link via source_script_id).
  // "manual" rows come from ad_approved_script_links (explicit retroactive tag).
  // Same fb_ad_id present in both sources is deduped — draft wins.
  source: "draft" | "manual";
}

interface AdDraftRow {
  id: string;
  name: string;
  status: string;
  fb_ad_id: string | null;
  ad_account_id: string | null;
  source_script_id: string | null;
}

interface ScriptLinkRow {
  id: string;
  fb_ad_id: string;
  fb_ad_account_id: string;
  approved_script_id: string;
}

// Pull every ad linked to any of the given script IDs (two DB round-trips —
// drafts and manual links — UNIONed). Manual links short-circuit if the same
// fb_ad_id already exists as a draft, so winner-detection counts each ad once.
export async function loadDraftLinks(
  supabase: SupabaseClient,
  scriptIds: string[]
): Promise<Map<string, DraftLink[]>> {
  const byScript = new Map<string, DraftLink[]>();
  if (scriptIds.length === 0) return byScript;

  // --- Source 1: drafts ---
  const { data: drafts, error: draftsErr } = await supabase
    .from("ad_drafts")
    .select("id, name, status, fb_ad_id, ad_account_id, source_script_id")
    .in("source_script_id", scriptIds);

  if (draftsErr) {
    throw new Error(`Failed to load ad drafts: ${draftsErr.message}`);
  }

  const seenAdIds = new Set<string>();
  for (const row of (drafts || []) as AdDraftRow[]) {
    if (!row.source_script_id) continue;
    const link: DraftLink = {
      id: row.id,
      name: row.name,
      status: row.status,
      fb_ad_id: row.fb_ad_id,
      source_script_id: row.source_script_id,
      fb_ad_account_id: row.ad_account_id,
      source: "draft",
    };
    if (link.fb_ad_id) seenAdIds.add(link.fb_ad_id);
    const existing = byScript.get(row.source_script_id) ?? [];
    existing.push(link);
    byScript.set(row.source_script_id, existing);
  }

  // --- Source 2: manual links (retroactive "Link to Live Ad") ---
  const { data: links, error: linksErr } = await supabase
    .from("ad_approved_script_links")
    .select("id, fb_ad_id, fb_ad_account_id, approved_script_id")
    .in("approved_script_id", scriptIds);

  if (linksErr) {
    throw new Error(`Failed to load script links: ${linksErr.message}`);
  }

  for (const row of (links || []) as ScriptLinkRow[]) {
    if (!row.fb_ad_id || !row.approved_script_id) continue;
    // Dedup: same ad already counted via a draft — skip the manual entry.
    if (seenAdIds.has(row.fb_ad_id)) continue;
    seenAdIds.add(row.fb_ad_id);
    const synthetic: DraftLink = {
      id: `manual:${row.id}`,
      // No draft-side metadata for retroactively-tagged ads — fall back to a
      // short fb_ad_id suffix. The Library detail modal renders the full id
      // alongside this name, so the marketer can still identify the ad.
      name: `FB Ad ${row.fb_ad_id.slice(-6)}`,
      status: "submitted",
      fb_ad_id: row.fb_ad_id,
      source_script_id: row.approved_script_id,
      fb_ad_account_id: row.fb_ad_account_id,
      source: "manual",
    };
    const existing = byScript.get(row.approved_script_id) ?? [];
    existing.push(synthetic);
    byScript.set(row.approved_script_id, existing);
  }

  return byScript;
}

interface ComputeOptions {
  fbToken: string;
  datePreset: DatePreset;
  includeDaily?: boolean; // only true for the per-script detail endpoint
  accountIdByAdId?: Map<string, string>;
  // When provided, joins ad_creative_analyses so each returned AdPerformanceSummary
  // carries its deconstruction (transcript, hook, scenes, tone, cta). Only used
  // by the per-script detail endpoint — the bulk endpoint skips this for speed.
  supabaseForDeconstructions?: SupabaseClient;
}

// Fetch insights for a batch of fb_ad_ids with bounded concurrency. Account id
// is required by the Meta API call; we pass an empty string when we don't have
// it — the insights call only needs the ad_id but we echo the account_id back
// in the response shape. If the account id is genuinely unknown, a graceful
// fallback still works.
async function fetchInsightsForAds(
  adIds: string[],
  fbToken: string,
  datePreset: DatePreset,
  accountIdByAdId?: Map<string, string>
): Promise<Map<string, DailyAdMetrics | null>> {
  const out = new Map<string, DailyAdMetrics | null>();

  for (let i = 0; i < adIds.length; i += CONCURRENCY) {
    const slice = adIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (adId) => {
        try {
          const accountId = accountIdByAdId?.get(adId) ?? "";
          const metrics = await fetchAdDailyInsights(
            adId,
            accountId,
            fbToken,
            datePreset
          );
          return [adId, metrics] as const;
        } catch {
          return [adId, null] as const;
        }
      })
    );
    for (const [id, metrics] of results) out.set(id, metrics);
  }

  return out;
}

function rollupTier(tiers: Array<ConsistencyTier | "no_data">): ConsistencyTier | "no_data" {
  if (tiers.length === 0) return "no_data";
  if (tiers.includes("stable_winner")) return "stable_winner";
  if (tiers.includes("spike")) return "spike";
  if (tiers.includes("stable_loser")) return "stable_loser";
  if (tiers.every((t) => t === "no_data")) return "no_data";
  return "dead";
}

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// Compute performance for a single script given its drafts. Used by both bulk
// and per-script endpoints.
export async function computeScriptPerformance(
  scriptId: string,
  drafts: DraftLink[],
  opts: ComputeOptions
): Promise<ScriptPerformance> {
  const submitted = drafts.filter((d) => d.fb_ad_id);
  const submittedCount = submitted.length;
  const liveCount = submitted.filter((d) => d.status === "submitted").length;

  if (submittedCount === 0) {
    return {
      script_id: scriptId,
      draft_count: drafts.length,
      submitted_count: 0,
      live_count: 0,
      spend: 0,
      purchases: 0,
      purchase_value: 0,
      cpp: 0,
      roas: 0,
      tier: "no_data",
      best_ad: null,
      ads: opts.includeDaily ? [] : undefined,
    };
  }

  const adIds = submitted.map((d) => d.fb_ad_id as string);

  // Each draft (or manual link) carries its own ad_account_id now that
  // loadDraftLinks unions both sources. Build the lookup from the drafts
  // themselves; explicit opts.accountIdByAdId overrides per ad if passed.
  const accountIdByAdId = new Map<string, string>();
  for (const draft of submitted) {
    if (draft.fb_ad_id && draft.fb_ad_account_id) {
      accountIdByAdId.set(draft.fb_ad_id, draft.fb_ad_account_id);
    }
  }
  if (opts.accountIdByAdId) {
    for (const [adId, accountId] of opts.accountIdByAdId.entries()) {
      accountIdByAdId.set(adId, accountId);
    }
  }

  const [insights, deconstructions] = await Promise.all([
    fetchInsightsForAds(
      adIds,
      opts.fbToken,
      opts.datePreset,
      accountIdByAdId
    ),
    opts.supabaseForDeconstructions
      ? loadDeconstructions(opts.supabaseForDeconstructions, adIds)
      : Promise.resolve(new Map<string, AdDeconstruction>()),
  ]);

  const summaries: AdPerformanceSummary[] = submitted.map((draft) => {
    const adId = draft.fb_ad_id as string;
    const metrics = insights.get(adId) ?? null;
    const deconstruction = deconstructions.get(adId) ?? null;
    if (!metrics) {
      return {
        fb_ad_id: adId,
        account_id: accountIdByAdId.get(adId) ?? null,
        draft_id: draft.id,
        draft_name: draft.name,
        draft_status: draft.status,
        spend: 0,
        purchases: 0,
        purchase_value: 0,
        cpp: 0,
        roas: 0,
        tier: "no_data",
        winning_days: 0,
        max_consecutive: 0,
        daily: opts.includeDaily ? [] : undefined,
        deconstruction: opts.supabaseForDeconstructions ? deconstruction : undefined,
      };
    }
    const c = classifyConsistency(metrics, DEFAULT_WINNER_THRESHOLDS);
    return {
      fb_ad_id: adId,
      account_id: metrics.account_id || (accountIdByAdId.get(adId) ?? null),
      draft_id: draft.id,
      draft_name: draft.name,
      draft_status: draft.status,
      spend: round(metrics.total.spend),
      purchases: metrics.total.purchases,
      purchase_value: round(metrics.total.purchase_value),
      cpp: round(metrics.total.cpp),
      roas: round(metrics.total.roas),
      tier: c.tier,
      winning_days: c.winning_days,
      max_consecutive: c.max_consecutive,
      daily: opts.includeDaily ? metrics.daily : undefined,
      deconstruction: opts.supabaseForDeconstructions ? deconstruction : undefined,
    };
  });

  const totals = summaries.reduce(
    (acc, s) => ({
      spend: acc.spend + s.spend,
      purchases: acc.purchases + s.purchases,
      purchase_value: acc.purchase_value + s.purchase_value,
    }),
    { spend: 0, purchases: 0, purchase_value: 0 }
  );
  const cpp = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const roas = totals.spend > 0 ? totals.purchase_value / totals.spend : 0;
  const tier = rollupTier(summaries.map((s) => s.tier));

  // "Best ad" = stable_winner first, then highest purchases
  const bestAd =
    [...summaries].sort((a, b) => {
      const aw = a.tier === "stable_winner" ? 1 : 0;
      const bw = b.tier === "stable_winner" ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return b.purchases - a.purchases;
    })[0] ?? null;

  return {
    script_id: scriptId,
    draft_count: drafts.length,
    submitted_count: submittedCount,
    live_count: liveCount,
    spend: round(totals.spend),
    purchases: totals.purchases,
    purchase_value: round(totals.purchase_value),
    cpp: round(cpp),
    roas: round(roas),
    tier,
    best_ad: bestAd,
    ads: opts.includeDaily ? summaries : undefined,
  };
}

export function getFbTokenFromRow(
  row: { value?: string | null } | null
): string | null {
  return (row?.value ?? null) as string | null;
}

export const WINNER_THRESHOLDS = DEFAULT_WINNER_THRESHOLDS;
