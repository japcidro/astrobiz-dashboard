import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { resolveBriefingBaseUrl } from "@/lib/briefings/base-url";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "@/lib/data-cache";
import {
  addDays,
  getBonusPeriod,
  getPreviousBonusPeriod,
  periodDays,
  phtToday,
  type BonusPeriod,
} from "@/lib/bonus/period";
import { computeTierProgress, tierForAverage } from "@/lib/bonus/tiers";
import type {
  BonusCppStats,
  BonusOverview,
  BonusParcelStats,
  BonusRtsStats,
  BonusTier,
} from "@/lib/bonus/types";

export const dynamic = "force-dynamic";

/** Rolling windows the CEO asked for, alongside the cutoff-period average. */
const CPP_WINDOW_DAYS = 15;
const RTS_WINDOW_DAYS = 30;

const CACHE_TTL_MS = 5 * 60 * 1000;

type JtRow = {
  submission_date: string | null;
  is_delivered: boolean | null;
  is_returned: boolean | null;
};

/** Bucket an ISO timestamp into its PHT calendar day. */
function toPhtDateStr(isoString: string): string {
  const d = new Date(isoString);
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, "0")}-${String(pht.getUTCDate()).padStart(2, "0")}`;
}

/**
 * J&T rows whose submission_date falls inside a PHT calendar range.
 *
 * submission_date is stored as an ISO timestamp, so the bounds have to be
 * anchored at PHT day boundaries — a bare `lte` against a date string drops
 * every row on the end day (same bug already documented in /api/profit/jt-data).
 */
async function fetchJtRows(
  supabase: ReturnType<typeof createServiceClient>,
  dateFrom: string,
  dateTo: string
): Promise<{ rows: JtRow[]; error: Error | null }> {
  const { data, error } = await fetchAllRows<JtRow>(
    () =>
      supabase
        .from("jt_deliveries")
        .select("submission_date, is_delivered, is_returned")
        .gte("submission_date", `${dateFrom}T00:00:00+08:00`)
        .lte("submission_date", `${dateTo}T23:59:59+08:00`),
    { orderColumn: "submission_date", ascending: true }
  );
  return { rows: data, error };
}

function buildParcelStats(rows: JtRow[], period: BonusPeriod): BonusParcelStats {
  const counts = new Map<string, number>();
  for (const day of periodDays(period)) counts.set(day, 0);

  for (const row of rows) {
    if (!row.submission_date) continue;
    const day = toPhtDateStr(row.submission_date);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const total = rows.filter((r) => r.submission_date).length;

  // Only days that have actually happened count toward the running average —
  // dividing by the full period before the cutoff would understate the pace.
  const divisor = period.days_elapsed > 0 ? period.days_elapsed : 1;
  const average = total / divisor;

  const daily = periodDays(period)
    .slice(0, Math.max(period.days_elapsed, 0))
    .map((date) => ({ date, count: counts.get(date) ?? 0 }));

  const best = daily.reduce<{ date: string; count: number } | null>(
    (acc, d) => (acc === null || d.count > acc.count ? d : acc),
    null
  );

  return {
    total,
    average_per_day: average,
    projected_total: Math.round(average * period.days_total),
    daily,
    best_day: best && best.count > 0 ? best : null,
  };
}

function buildRtsStats(
  rows: JtRow[],
  dateFrom: string,
  dateTo: string
): BonusRtsStats {
  const delivered = rows.filter((r) => r.is_delivered === true).length;
  const returned = rows.filter((r) => r.is_returned === true).length;
  const settled = delivered + returned;

  return {
    // Rate is against SETTLED parcels only. Including still-in-transit
    // parcels in the denominator would make a busy shipping week look like
    // a improving RTS rate purely because the outcomes hadn't landed yet.
    rate_pct: settled > 0 ? (returned / settled) * 100 : 0,
    returned,
    delivered,
    settled,
    in_transit: rows.length - settled,
    total: rows.length,
    window_days: RTS_WINDOW_DAYS,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

/**
 * Average CPP over the rolling window, read from the existing P&L pipeline
 * so the number on this page is the same one on /admin/profit rather than a
 * second, subtly-different definition.
 *
 * The P&L route is admin-gated, so this authenticates with CRON_SECRET the
 * same way the AI tools and briefing collectors do. The page itself is open
 * to every role — reading an aggregate CPP is intentional, that's what the
 * CEO asked to show the team.
 */
async function fetchCppStats(
  request: Request,
  dateFrom: string,
  dateTo: string
): Promise<BonusCppStats> {
  const base: BonusCppStats = {
    average: 0,
    ad_spend: 0,
    order_count: 0,
    window_days: CPP_WINDOW_DAYS,
    date_from: dateFrom,
    date_to: dateTo,
    error: null,
  };

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { ...base, error: "CRON_SECRET not configured — CPP unavailable." };
  }

  const params = new URLSearchParams({
    date_filter: "custom",
    store: "ALL",
    date_from: dateFrom,
    date_to: dateTo,
  });

  try {
    const res = await fetch(
      `${resolveBriefingBaseUrl(request)}/api/profit/daily?${params}`,
      {
        headers: { Authorization: `Bearer ${cronSecret}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return { ...base, error: `P&L read failed (HTTP ${res.status})` };
    }

    const json = (await res.json()) as {
      summary?: { ad_spend?: number; order_count?: number; cpp?: number };
    };
    const adSpend = Number(json.summary?.ad_spend ?? 0);
    const orders = Number(json.summary?.order_count ?? 0);

    return {
      ...base,
      ad_spend: adSpend,
      order_count: orders,
      // Weighted across the window (total spend ÷ total orders), not a mean
      // of daily CPPs — a zero-order day would otherwise distort the average.
      average: orders > 0 ? adSpend / orders : 0,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : "P&L read failed",
    };
  }
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";

  // jt_deliveries is admin-only under RLS, but this page is for the whole
  // team — read with the service client AFTER establishing the session above,
  // and return only aggregates (never per-waybill rows).
  const supabase = createServiceClient();

  const today = phtToday();
  const cacheKey = buildCacheKey("bonus_overview", { day: today });

  if (!forceRefresh) {
    const cached = await getCachedResponse<BonusOverview>(
      supabase,
      cacheKey,
      CACHE_TTL_MS
    );
    if (cached) {
      return Response.json({ ...cached.data, from_cache: true });
    }
  }

  const period = getBonusPeriod(today);
  const prevPeriod = getPreviousBonusPeriod(today);
  const rtsFrom = addDays(today, -(RTS_WINDOW_DAYS - 1));
  const cppFrom = addDays(today, -(CPP_WINDOW_DAYS - 1));

  const [tiersRes, currentJt, prevJt, rtsJt, cpp] = await Promise.all([
    supabase
      .from("bonus_tiers")
      .select("id, parcel_threshold, bonus_amount, label, is_active")
      .order("parcel_threshold", { ascending: true }),
    fetchJtRows(supabase, period.start, period.end),
    fetchJtRows(supabase, prevPeriod.start, prevPeriod.end),
    fetchJtRows(supabase, rtsFrom, today),
    fetchCppStats(request, cppFrom, today),
  ]);

  const jtError = currentJt.error || prevJt.error || rtsJt.error;
  if (jtError) {
    return Response.json({ error: jtError.message }, { status: 500 });
  }
  if (tiersRes.error) {
    return Response.json({ error: tiersRes.error.message }, { status: 500 });
  }

  const tiers: BonusTier[] = (tiersRes.data ?? []).map((r) => ({
    id: r.id as string,
    parcel_threshold: Number(r.parcel_threshold),
    bonus_amount: Number(r.bonus_amount ?? 0),
    label: (r.label as string | null) ?? null,
    is_active: r.is_active !== false,
  }));

  const parcels = buildParcelStats(currentJt.rows, period);
  const progress = computeTierProgress(
    parcels.average_per_day,
    parcels.total,
    period,
    tiers
  );

  const prevTotal = prevJt.rows.filter((r) => r.submission_date).length;
  const prevAverage =
    prevPeriod.days_total > 0 ? prevTotal / prevPeriod.days_total : 0;

  const overview: BonusOverview = {
    period,
    parcels,
    tiers,
    progress,
    cpp,
    rts: buildRtsStats(rtsJt.rows, rtsFrom, today),
    previous: {
      period: prevPeriod,
      total: prevTotal,
      average_per_day: prevAverage,
      tier: tierForAverage(prevAverage, tiers),
    },
    generated_at: new Date().toISOString(),
  };

  await setCachedResponse(supabase, "bonus_overview", cacheKey, overview);

  return Response.json(overview);
}
