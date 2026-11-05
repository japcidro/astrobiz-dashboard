import type { SupabaseClient } from "@supabase/supabase-js";
import { RateLimitedError, inspectFbResponse } from "@/lib/facebook/rate-limit";
import { addDays, phtToday, type DailyRow } from "./launched-creatives";

// Per-ad per-day insights, kept in fb_ad_daily_insights so "first 3 days"
// and "first 7 days" can be read for any ad without asking Facebook again.
//
// A refresh asks Facebook only for what the table lacks: a new ad from its
// launch day, a known ad for the last 7 days (purchases keep being
// attributed to an ad for up to a week after the click). Ads are read 50 at
// a time per account with time_increment=1, so a 30-day window of launches
// costs a handful of calls, not one per ad.

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const IDS_PER_CALL = 50;
const PAGE_LIMIT = 500;
const CONCURRENCY = 4;
/** Days re-read on every refresh so late attribution catches up. */
const REREAD_DAYS = 7;
/** A sync older than this (in minutes) is redone even when nothing new launched. */
export const SYNC_FRESH_MINUTES = 20;

const FIELDS = [
  "ad_id",
  "date_start",
  "spend",
  "impressions",
  "reach",
  "actions",
  "action_values",
].join(",");

export interface SyncTarget {
  ad_id: string;
  account_id: string;
  /** PHT day the ad went live; null when it has not launched yet. */
  launch_date: string | null;
}

export interface SyncResult {
  rows_written: number;
  calls: number;
  errors: string[];
  rate_limited: boolean;
}

function getAction(arr: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!arr) return 0;
  return parseFloat(arr.find((a) => a.action_type === type)?.value || "0");
}

export function parseInsightRow(row: Record<string, unknown>): (DailyRow & { ad_id: string }) | null {
  const adId = row.ad_id as string | undefined;
  const date = row.date_start as string | undefined;
  if (!adId || !date) return null;
  const actions = row.actions as Array<{ action_type: string; value: string }> | undefined;
  const values = row.action_values as Array<{ action_type: string; value: string }> | undefined;
  return {
    ad_id: adId,
    date,
    spend: parseFloat((row.spend as string) || "0"),
    purchases: Math.round(
      getAction(actions, "purchase") || getAction(actions, "offsite_conversion.fb_pixel_purchase")
    ),
    purchase_value:
      getAction(values, "purchase") || getAction(values, "offsite_conversion.fb_pixel_purchase"),
    add_to_cart: Math.round(
      getAction(actions, "add_to_cart") || getAction(actions, "offsite_conversion.fb_pixel_add_to_cart")
    ),
    link_clicks: Math.round(getAction(actions, "link_click")),
    landing_page_views: Math.round(getAction(actions, "landing_page_view")),
    impressions: parseInt((row.impressions as string) || "0", 10),
    reach: parseInt((row.reach as string) || "0", 10),
  };
}

async function fetchDaily(
  db: SupabaseClient,
  token: string,
  accountId: string,
  adIds: string[],
  since: string,
  until: string,
  timeoutMs = 15000
): Promise<{ rows: Array<DailyRow & { ad_id: string }>; calls: number }> {
  const rows: Array<DailyRow & { ad_id: string }> = [];
  let url: string | null =
    `${FB_API_BASE}/${accountId}/insights?` +
    new URLSearchParams({
      access_token: token,
      level: "ad",
      fields: FIELDS,
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: adIds }]),
      limit: String(PAGE_LIMIT),
    }).toString();
  let calls = 0;
  while (url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let json: { data?: Array<Record<string, unknown>>; paging?: { next?: string }; error?: { message?: string } };
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      calls += 1;
      await inspectFbResponse(res, db);
      json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `FB insights error ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    for (const r of json.data ?? []) {
      const parsed = parseInsightRow(r);
      if (parsed) rows.push(parsed);
    }
    url = json.paging?.next ?? null;
  }
  return { rows, calls };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Read from Facebook whatever fb_ad_daily_insights lacks for these ads and
 * write it. `db` must be the service client. Never throws: Facebook trouble
 * comes back in `errors` / `rate_limited`, and whatever was stored still
 * serves the screen.
 */
export async function syncDailyInsights(
  db: SupabaseClient,
  token: string,
  targets: SyncTarget[],
  now: Date = new Date()
): Promise<SyncResult> {
  const result: SyncResult = { rows_written: 0, calls: 0, errors: [], rate_limited: false };
  const launched = targets.filter((t) => t.launch_date);
  if (launched.length === 0) return result;

  const today = phtToday(now);
  const rereadFrom = addDays(today, -(REREAD_DAYS - 1));

  const synced = new Map<string, string>();
  const ids = launched.map((t) => t.ad_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("fb_ad_insight_sync")
      .select("ad_id, synced_through")
      .in("ad_id", ids.slice(i, i + 200));
    for (const r of data ?? []) synced.set(r.ad_id as string, r.synced_through as string);
  }

  // Each ad's "since": its launch day when never read; otherwise the re-read
  // window, stretched back to cover any days missed since the last sync.
  const plan = launched.map((t) => {
    const launch = t.launch_date as string;
    const through = synced.get(t.ad_id);
    // since = max(launch, min(through - 1, rereadFrom)), never past today.
    let since = launch;
    if (through) {
      const dayBefore = addDays(through, -1);
      const reread = dayBefore < rereadFrom ? dayBefore : rereadFrom;
      since = reread > launch ? reread : launch;
    }
    return { ...t, since: since > today ? today : since };
  });

  // Group by account, order by since so each 50-ad chunk spans few days.
  const byAccount = new Map<string, typeof plan>();
  for (const p of plan) {
    const list = byAccount.get(p.account_id) ?? [];
    list.push(p);
    byAccount.set(p.account_id, list);
  }
  const jobs: Array<{ account_id: string; ad_ids: string[]; since: string }> = [];
  for (const [account_id, list] of byAccount) {
    list.sort((a, b) => a.since.localeCompare(b.since));
    for (let i = 0; i < list.length; i += IDS_PER_CALL) {
      const chunk = list.slice(i, i + IDS_PER_CALL);
      jobs.push({ account_id, ad_ids: chunk.map((c) => c.ad_id), since: chunk[0].since });
    }
  }

  const fetched: Array<DailyRow & { ad_id: string; account_id: string }> = [];
  const doneAds = new Set<string>();
  await mapLimit(jobs, CONCURRENCY, async (job) => {
    if (result.rate_limited) return;
    try {
      const { rows, calls } = await fetchDaily(db, token, job.account_id, job.ad_ids, job.since, today);
      result.calls += calls;
      for (const r of rows) fetched.push({ ...r, account_id: job.account_id });
      for (const id of job.ad_ids) doneAds.add(id);
    } catch (e) {
      if (e instanceof RateLimitedError) {
        result.rate_limited = true;
        result.errors.push(e.message);
        return;
      }
      result.errors.push(`${job.account_id}: ${e instanceof Error ? e.message : "insights failed"}`);
    }
  });

  const refreshedAt = now.toISOString();
  for (let i = 0; i < fetched.length; i += 500) {
    const batch = fetched.slice(i, i + 500).map((r) => ({ ...r, refreshed_at: refreshedAt }));
    const { error } = await db
      .from("fb_ad_daily_insights")
      .upsert(batch, { onConflict: "ad_id,date" });
    if (error) result.errors.push(`write: ${error.message}`);
    else result.rows_written += batch.length;
  }

  // Only ads whose read completed are marked read through today.
  const syncRows = plan
    .filter((p) => doneAds.has(p.ad_id))
    .map((p) => ({
      ad_id: p.ad_id,
      account_id: p.account_id,
      synced_through: today,
      refreshed_at: refreshedAt,
    }));
  for (let i = 0; i < syncRows.length; i += 500) {
    const { error } = await db
      .from("fb_ad_insight_sync")
      .upsert(syncRows.slice(i, i + 500), { onConflict: "ad_id" });
    if (error) result.errors.push(`sync: ${error.message}`);
  }
  return result;
}

/** Daily rows for many ads, keyed by ad id, oldest day first. Session client is fine. */
export async function loadDailySeries(
  db: SupabaseClient,
  adIds: string[]
): Promise<Map<string, DailyRow[]>> {
  const out = new Map<string, DailyRow[]>();
  for (let i = 0; i < adIds.length; i += 500) {
    const { data, error } = await db.rpc("fb_ad_daily_series", { p_ad_ids: adIds.slice(i, i + 500) });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ ad_id: string; daily: DailyRow[] }>) {
      out.set(
        r.ad_id,
        (r.daily ?? []).map((d) => ({
          date: d.date,
          spend: Number(d.spend) || 0,
          purchases: Number(d.purchases) || 0,
          purchase_value: Number(d.purchase_value) || 0,
          add_to_cart: Number(d.add_to_cart) || 0,
          link_clicks: Number(d.link_clicks) || 0,
          landing_page_views: Number(d.landing_page_views) || 0,
          impressions: Number(d.impressions) || 0,
          reach: Number(d.reach) || 0,
        }))
      );
    }
  }
  return out;
}
