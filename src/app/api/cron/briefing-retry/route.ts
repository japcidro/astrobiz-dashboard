import { createServiceClient } from "@/lib/supabase/service";
import { runBriefing } from "@/lib/briefings/run";
import { resolveBriefingBaseUrl } from "@/lib/briefings/base-url";
import type {
  BriefingType,
  BriefingData,
  PeriodRange,
  FetchError,
} from "@/lib/briefings/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Heals briefings that landed in the table with fetch errors or all-zero
// data (typically because /api/profit/daily, /api/facebook/all-ads, or
// /api/shopify/orders timed out / rate-limited at cron time). Runs every
// 30 min, reruns each candidate up to MAX_RETRIES times. Once the data is
// clean, runBriefing sends the (possibly first, possibly "[Updated]")
// email so admins still get one accurate report per period.

const MAX_RETRIES = 5;
// 48h covers the morning briefing of the previous calendar day even when
// the retry cron only starts running mid-day. Anything older than that
// the admin can still kick manually with the Rebuild button per row.
const LOOKBACK_HOURS = 48;

const TYPE_PRESET: Record<BriefingType, string> = {
  morning: "yesterday",
  evening: "today",
  weekly: "last_7_days",
  monthly: "last_30_days",
};

interface CandidateRow {
  id: string;
  type: BriefingType;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  data: BriefingData | null;
  fetch_errors: FetchError[] | null;
  retry_count: number | null;
  email_sent_at: string | null;
}

function isFullyZero(d: BriefingData | null): boolean {
  if (!d) return true;
  return (d.revenue ?? 0) === 0
    && (d.orders ?? 0) === 0
    && (d.ad_spend ?? 0) === 0;
}

function needsRetry(row: CandidateRow): boolean {
  const hasErrors = Array.isArray(row.fetch_errors) && row.fetch_errors.length > 0;
  return hasErrors || isFullyZero(row.data);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const baseUrl = resolveBriefingBaseUrl(request);
  const cronSecret = process.env.CRON_SECRET!;

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // Fetch all recent briefings, filter client-side. This avoids gnarly
  // jsonb-array-length filters in PostgREST and keeps the query simple.
  const { data: rows, error } = await supabase
    .from("briefings")
    .select(
      "id, type, period_label, period_start, period_end, data, fetch_errors, retry_count, email_sent_at"
    )
    .gte("created_at", cutoff)
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const candidates = ((rows ?? []) as CandidateRow[]).filter(needsRetry);

  if (candidates.length === 0) {
    return Response.json({ checked: rows?.length ?? 0, retried: 0, results: [] });
  }

  const results: Array<{
    id: string;
    type: BriefingType;
    period: string;
    success: boolean;
    error?: string;
    fetch_errors?: FetchError[];
    email_sent?: number;
  }> = [];

  // Sequential to avoid hammering FB/Shopify with parallel reruns when a
  // single rate-limit window probably caused the original failure.
  for (const row of candidates) {
    if (!row.period_start || !row.period_end) {
      results.push({
        id: row.id,
        type: row.type,
        period: "unknown",
        success: false,
        error: "missing period_start/period_end",
      });
      continue;
    }

    // Reconstruct the period at midday PHT so phtDateString round-trips
    // back to the exact same calendar date.
    const period: PeriodRange = {
      start: new Date(`${row.period_start}T12:00:00+08:00`),
      end: new Date(`${row.period_end}T12:00:00+08:00`),
      label: row.period_label,
      dateFilter: "custom",
      datePreset: TYPE_PRESET[row.type],
    };

    const result = await runBriefing(supabase, baseUrl, cronSecret, row.type, {
      period,
    });

    results.push({
      id: row.id,
      type: row.type,
      period: row.period_label,
      success: result.success,
      error: result.error,
      fetch_errors: result.fetch_errors,
      email_sent: result.email?.sent,
    });
  }

  const recovered = results.filter((r) => r.success && (r.fetch_errors?.length ?? 0) === 0).length;

  return Response.json({
    checked: rows?.length ?? 0,
    retried: candidates.length,
    recovered,
    results,
  });
}
