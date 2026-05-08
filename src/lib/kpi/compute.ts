import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { KpiTarget } from "./types";
import { computeKpiStatus } from "./status";

type Sb = SupabaseClient;

interface ComputeContext {
  sb: Sb;
  asOfDate: string;        // YYYY-MM-DD
  windowStart7: string;    // YYYY-MM-DD, 7 days back
  windowStart14: string;   // YYYY-MM-DD, 14 days back
  weekStart: string;       // Monday of current week, YYYY-MM-DD
  employees: { id: string; full_name: string; role: string }[];
}

interface KpiComputation {
  kpi_key: string;
  scope: "individual" | "team" | "watch";
  employee_id: string | null;
  value: number;
  raw_data: Record<string, unknown>;
}

interface ComputeResult {
  computed: number;
  upserted: number;
  errors: string[];
}

/**
 * Run all KPI computers and upsert daily snapshots.
 */
export async function computeAllKpis(
  sb: Sb,
  asOfDate: string,
): Promise<ComputeResult> {
  const result: ComputeResult = { computed: 0, upserted: 0, errors: [] };

  const ctx = await buildContext(sb, asOfDate);

  const { data: targets } = await sb
    .from("kpi_targets")
    .select("*")
    .eq("is_active", true);
  const targetMap = new Map<string, KpiTarget>(
    (targets ?? []).map((t) => [`${t.kpi_key}|${t.scope}`, t as KpiTarget]),
  );

  const computers: Array<(c: ComputeContext) => Promise<KpiComputation[]>> = [
    computeMktCreativesTested,
    computeMktWinners,           // stub returns [] for now
    computeMktBlendedRoas,       // stub returns [] for now
    computeVaConfirmationRate,
    computeVaCallsPerDay,
    computeVaTimeToFirstCall,
    computeVaQueueCleared,
    computeVaSaveRate,
    computeFulfillPerfectPackRate,
    computeFulfillStockVariance,
    computeWatchRtsRate,
  ];

  const allComputations: KpiComputation[] = [];
  for (const fn of computers) {
    try {
      const rows = await fn(ctx);
      allComputations.push(...rows);
    } catch (err) {
      result.errors.push(`${fn.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  result.computed = allComputations.length;

  // Upsert in chunks
  const chunks: KpiComputation[][] = [];
  for (let i = 0; i < allComputations.length; i += 200) {
    chunks.push(allComputations.slice(i, i + 200));
  }

  for (const chunk of chunks) {
    const records = chunk.map((c) => {
      const target = targetMap.get(`${c.kpi_key}|${c.scope}`);
      if (!target) return null;
      const status = computeKpiStatus(
        c.value,
        Number(target.red_threshold),
        Number(target.green_threshold),
        target.direction,
      );
      return {
        snapshot_date: asOfDate,
        kpi_key: c.kpi_key,
        scope: c.scope,
        employee_id: c.employee_id,
        value: c.value,
        status,
        raw_data: c.raw_data,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    // Single unique index (nulls not distinct) handles both individual and team rows
    if (records.length) {
      const { error, count } = await sb
        .from("kpi_daily_snapshots")
        .upsert(records, {
          onConflict: "snapshot_date,kpi_key,scope,employee_id",
          count: "exact",
        });
      if (error) result.errors.push(`upsert: ${error.message}`);
      else result.upserted += count ?? records.length;
    }
  }

  return result;
}

// ============================================
// Context builder
// ============================================

async function buildContext(sb: Sb, asOfDate: string): Promise<ComputeContext> {
  const asOf = new Date(asOfDate + "T23:59:59Z");
  const subtract = (days: number) =>
    new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Monday of current week (PHT-ish; close enough for daily snapshots)
  const dayOfWeek = asOf.getUTCDay(); // 0 sun … 6 sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = subtract(daysSinceMonday);

  const { data: emps } = await sb
    .from("employees")
    .select("id, full_name, role")
    .eq("is_active", true);

  return {
    sb,
    asOfDate,
    windowStart7: subtract(7),
    windowStart14: subtract(14),
    weekStart,
    employees: (emps ?? []) as ComputeContext["employees"],
  };
}

// ============================================
// MARKETING
// ============================================

async function computeMktCreativesTested(ctx: ComputeContext): Promise<KpiComputation[]> {
  const marketers = ctx.employees.filter((e) => e.role === "marketing");
  if (marketers.length === 0) return [];

  const { data: rows } = await fetchAllRows<{ created_by: string | null; fb_ad_id: string }>(
    () =>
      ctx.sb
        .from("fb_ad_attribution")
        .select("created_by, fb_ad_id, fb_created_time, is_test")
        .eq("is_test", true)
        .gte("fb_created_time", ctx.windowStart7 + "T00:00:00Z")
        .lte("fb_created_time", ctx.asOfDate + "T23:59:59Z"),
    { orderColumn: "fb_created_time", ascending: false },
  );

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r.created_by) {
      counts.set(r.created_by, (counts.get(r.created_by) ?? 0) + 1);
    }
  }

  return marketers.map((m) => ({
    kpi_key: "mkt_creatives_tested_weekly",
    scope: "individual" as const,
    employee_id: m.id,
    value: counts.get(m.id) ?? 0,
    raw_data: {
      window_start: ctx.windowStart7,
      window_end: ctx.asOfDate,
      total_tagged: counts.get(m.id) ?? 0,
      note: "Counts FB ads tagged is_test=true with this marketer as created_by in last 7 days.",
    },
  }));
}

async function computeMktWinners(_ctx: ComputeContext): Promise<KpiComputation[]> {
  // TODO Phase 1.5 — wire to existing winner detection (ROAS ≥ 5.0 for 3 consecutive days).
  // Currently winner state lives in scaling_detection_cache + live FB queries.
  // Will revisit once we cache daily insights in a kpi-friendly table.
  return [];
}

async function computeMktBlendedRoas(_ctx: ComputeContext): Promise<KpiComputation[]> {
  // TODO Phase 1.5 — sum spend + purchase_value across all active campaigns over last 7 days.
  // Requires either pulling FB Insights API in cron or caching daily totals.
  return [];
}

// ============================================
// SALES / VA
// ============================================

async function computeVaConfirmationRate(ctx: ComputeContext): Promise<KpiComputation[]> {
  const vas = ctx.employees.filter((e) => e.role === "va");
  if (vas.length === 0) return [];

  const { data: rows } = await fetchAllRows<{
    va_id: string | null;
    outcome: string | null;
  }>(
    () =>
      ctx.sb
        .from("call_attempts")
        .select("va_id, outcome, started_at")
        .eq("call_source", "va_browser")
        .gte("started_at", ctx.windowStart7 + "T00:00:00Z")
        .lte("started_at", ctx.asOfDate + "T23:59:59Z")
        .not("outcome", "is", null),
    { orderColumn: "started_at", ascending: false },
  );

  const stats = new Map<string, { total: number; confirmed: number }>();
  for (const r of rows ?? []) {
    if (!r.va_id) continue;
    const cur = stats.get(r.va_id) ?? { total: 0, confirmed: 0 };
    cur.total += 1;
    if (r.outcome === "confirmed") cur.confirmed += 1;
    stats.set(r.va_id, cur);
  }

  return vas.map((v) => {
    const s = stats.get(v.id) ?? { total: 0, confirmed: 0 };
    const value = s.total > 0 ? (s.confirmed / s.total) * 100 : 0;
    return {
      kpi_key: "va_confirmation_rate",
      scope: "individual" as const,
      employee_id: v.id,
      value,
      raw_data: {
        confirmed: s.confirmed,
        total_calls: s.total,
        window_start: ctx.windowStart7,
        window_end: ctx.asOfDate,
      },
    };
  });
}

async function computeVaCallsPerDay(ctx: ComputeContext): Promise<KpiComputation[]> {
  const vas = ctx.employees.filter((e) => e.role === "va");
  if (vas.length === 0) return [];

  const { data: rows } = await fetchAllRows<{ va_id: string | null }>(
    () =>
      ctx.sb
        .from("call_attempts")
        .select("va_id, started_at")
        .eq("call_source", "va_browser")
        .gte("started_at", ctx.asOfDate + "T00:00:00Z")
        .lte("started_at", ctx.asOfDate + "T23:59:59Z"),
    { orderColumn: "started_at", ascending: false },
  );

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r.va_id) counts.set(r.va_id, (counts.get(r.va_id) ?? 0) + 1);
  }

  return vas.map((v) => ({
    kpi_key: "va_calls_per_day",
    scope: "individual" as const,
    employee_id: v.id,
    value: counts.get(v.id) ?? 0,
    raw_data: {
      day: ctx.asOfDate,
      calls: counts.get(v.id) ?? 0,
    },
  }));
}

async function computeVaTimeToFirstCall(ctx: ComputeContext): Promise<KpiComputation[]> {
  const vas = ctx.employees.filter((e) => e.role === "va");
  if (vas.length === 0) return [];

  // v1 proxy: queue dwell time (created_at → started_at) for each VA's calls in last 7 days.
  // True "time from order placement" requires storing Shopify created_at locally — Phase 2.
  const { data: rows } = await fetchAllRows<{
    va_id: string | null;
    created_at: string;
    started_at: string | null;
  }>(
    () =>
      ctx.sb
        .from("call_attempts")
        .select("va_id, created_at, started_at")
        .eq("call_source", "va_browser")
        .gte("started_at", ctx.windowStart7 + "T00:00:00Z")
        .lte("started_at", ctx.asOfDate + "T23:59:59Z")
        .not("started_at", "is", null),
    { orderColumn: "started_at", ascending: false },
  );

  const buckets = new Map<string, number[]>();
  for (const r of rows ?? []) {
    if (!r.va_id || !r.started_at) continue;
    const dwellMs = new Date(r.started_at).getTime() - new Date(r.created_at).getTime();
    const dwellHours = dwellMs / (1000 * 60 * 60);
    if (dwellHours < 0 || dwellHours > 168) continue; // outliers
    const arr = buckets.get(r.va_id) ?? [];
    arr.push(dwellHours);
    buckets.set(r.va_id, arr);
  }

  return vas.map((v) => {
    const arr = (buckets.get(v.id) ?? []).slice().sort((a, b) => a - b);
    const median = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    return {
      kpi_key: "va_time_to_first_call",
      scope: "individual" as const,
      employee_id: v.id,
      value: median,
      raw_data: {
        sample_size: arr.length,
        median_hours: median,
        proxy_note: "v1 measures queue dwell (created_at → started_at), not Shopify order age.",
      },
    };
  });
}

async function computeVaQueueCleared(ctx: ComputeContext): Promise<KpiComputation[]> {
  // For today: of all distinct orders that entered the VA queue (call_attempts.created_at today),
  // what % had at least one started_at in (va_browser source).
  const { data: rows } = await fetchAllRows<{
    shopify_order_id: string;
    started_at: string | null;
  }>(
    () =>
      ctx.sb
        .from("call_attempts")
        .select("shopify_order_id, started_at, call_source")
        .gte("created_at", ctx.asOfDate + "T00:00:00Z")
        .lte("created_at", ctx.asOfDate + "T23:59:59Z")
        .eq("call_source", "va_browser"),
    { orderColumn: "created_at", ascending: false },
  );

  const orderHandled = new Map<string, boolean>();
  for (const r of rows ?? []) {
    const prev = orderHandled.get(r.shopify_order_id) ?? false;
    orderHandled.set(r.shopify_order_id, prev || r.started_at !== null);
  }

  const total = orderHandled.size;
  const handled = Array.from(orderHandled.values()).filter(Boolean).length;
  const value = total > 0 ? (handled / total) * 100 : 0;

  return [
    {
      kpi_key: "va_queue_cleared_eod",
      scope: "team" as const,
      employee_id: null,
      value,
      raw_data: {
        day: ctx.asOfDate,
        orders_in_queue: total,
        orders_handled: handled,
        note: "v1 counts orders in va_browser source today; refine when shared queue is built.",
      },
    },
  ];
}

async function computeVaSaveRate(ctx: ComputeContext): Promise<KpiComputation[]> {
  const { data: rows } = await fetchAllRows<{
    shopify_order_id: string;
    outcome: string | null;
    started_at: string | null;
  }>(
    () =>
      ctx.sb
        .from("call_attempts")
        .select("shopify_order_id, outcome, started_at")
        .eq("call_source", "va_browser")
        .gte("started_at", ctx.windowStart7 + "T00:00:00Z")
        .lte("started_at", ctx.asOfDate + "T23:59:59Z")
        .not("outcome", "is", null),
    { orderColumn: "started_at", ascending: true },
  );

  const orderOutcomes = new Map<string, string[]>();
  for (const r of rows ?? []) {
    const arr = orderOutcomes.get(r.shopify_order_id) ?? [];
    if (r.outcome) arr.push(r.outcome);
    orderOutcomes.set(r.shopify_order_id, arr);
  }

  let atRisk = 0;
  let saved = 0;
  for (const outcomes of orderOutcomes.values()) {
    const hadRisk = outcomes.some((o) =>
      ["declined", "needs_callback", "no_answer"].includes(o),
    );
    if (!hadRisk) continue;
    atRisk += 1;
    if (outcomes.includes("confirmed")) saved += 1;
  }

  const value = atRisk > 0 ? (saved / atRisk) * 100 : 0;
  return [
    {
      kpi_key: "va_cancellation_save_rate",
      scope: "team" as const,
      employee_id: null,
      value,
      raw_data: {
        at_risk_orders: atRisk,
        saved: saved,
        window_start: ctx.windowStart7,
        window_end: ctx.asOfDate,
      },
    },
  ];
}

// ============================================
// FULFILLMENT
// ============================================

async function computeFulfillPerfectPackRate(ctx: ComputeContext): Promise<KpiComputation[]> {
  const fulfillers = ctx.employees.filter((e) => e.role === "fulfillment");
  if (fulfillers.length === 0) return [];

  // Strategy:
  //   For each pack_verification completed in last 7 days,
  //   - perfect = (completed_at - confirmation_at <= 24h) AND no packing_errors row for that order
  //   - confirmation_at = call_attempts.ended_at where outcome='confirmed' for that order_id (earliest)
  //   - if no confirmation_at known, treat as perfect=false (conservative)
  //   - bucket by verified_by (the packer)
  const { data: packs } = await fetchAllRows<{
    order_id: string;
    verified_by: string | null;
    completed_at: string | null;
    status: string;
  }>(
    () =>
      ctx.sb
        .from("pack_verifications")
        .select("order_id, verified_by, completed_at, status")
        .gte("completed_at", ctx.windowStart7 + "T00:00:00Z")
        .lte("completed_at", ctx.asOfDate + "T23:59:59Z")
        .not("completed_at", "is", null),
    { orderColumn: "completed_at", ascending: false },
  );

  const orderIds = Array.from(
    new Set((packs ?? []).map((p) => p.order_id).filter(Boolean)),
  );

  if (orderIds.length === 0) {
    return fulfillers.map((f) => ({
      kpi_key: "fulfill_perfect_pack_rate",
      scope: "individual" as const,
      employee_id: f.id,
      value: 0,
      raw_data: {
        packs_total: 0,
        perfect: 0,
        note: "No pack_verifications in window.",
      },
    }));
  }

  // Confirmation timestamps from call_attempts
  const confirmationByOrder = new Map<string, string>();
  // Chunk to avoid >1000-id .in() URL bombs
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunkIds = orderIds.slice(i, i + 500);
    const { data: confirmations } = await ctx.sb
      .from("call_attempts")
      .select("shopify_order_id, ended_at, outcome")
      .in("shopify_order_id", chunkIds)
      .eq("outcome", "confirmed")
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: true });
    for (const c of confirmations ?? []) {
      if (!confirmationByOrder.has(c.shopify_order_id)) {
        confirmationByOrder.set(c.shopify_order_id, c.ended_at as string);
      }
    }
  }

  // Packing errors
  const errorOrders = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunkIds = orderIds.slice(i, i + 500);
    const { data: errors } = await ctx.sb
      .from("packing_errors")
      .select("shopify_order_id")
      .in("shopify_order_id", chunkIds);
    for (const e of errors ?? []) errorOrders.add(e.shopify_order_id);
  }

  const stats = new Map<string, { total: number; perfect: number }>();
  for (const p of packs ?? []) {
    if (!p.verified_by || !p.completed_at) continue;
    const cur = stats.get(p.verified_by) ?? { total: 0, perfect: 0 };
    cur.total += 1;

    const confirmedAt = confirmationByOrder.get(p.order_id);
    const within24h = confirmedAt
      ? new Date(p.completed_at).getTime() - new Date(confirmedAt).getTime() <=
        24 * 60 * 60 * 1000
      : false;
    const noError = !errorOrders.has(p.order_id);
    if (within24h && noError) cur.perfect += 1;
    stats.set(p.verified_by, cur);
  }

  return fulfillers.map((f) => {
    const s = stats.get(f.id) ?? { total: 0, perfect: 0 };
    const value = s.total > 0 ? (s.perfect / s.total) * 100 : 0;
    return {
      kpi_key: "fulfill_perfect_pack_rate",
      scope: "individual" as const,
      employee_id: f.id,
      value,
      raw_data: {
        packs_total: s.total,
        perfect: s.perfect,
        window_start: ctx.windowStart7,
        window_end: ctx.asOfDate,
        rule: "completed_at <= confirmation_at + 24h AND no packing_errors row",
      },
    };
  });
}

async function computeFulfillStockVariance(ctx: ComputeContext): Promise<KpiComputation[]> {
  const { data: counts } = await ctx.sb
    .from("stock_counts")
    .select("sku, expected_qty, actual_qty, week_starting")
    .eq("week_starting", ctx.weekStart);

  if (!counts || counts.length === 0) {
    return [
      {
        kpi_key: "fulfill_stock_variance",
        scope: "team" as const,
        employee_id: null,
        value: 0,
        raw_data: {
          week_starting: ctx.weekStart,
          skus_counted: 0,
          note: "No stock counts logged for this week yet.",
        },
      },
    ];
  }

  const variances = counts
    .map((c) => {
      const exp = Number(c.expected_qty) || 0;
      const act = Number(c.actual_qty) || 0;
      if (exp === 0) return 0;
      return Math.abs(exp - act) / exp;
    })
    .filter((v) => Number.isFinite(v));

  const avg = variances.length
    ? (variances.reduce((s, v) => s + v, 0) / variances.length) * 100
    : 0;

  return [
    {
      kpi_key: "fulfill_stock_variance",
      scope: "team" as const,
      employee_id: null,
      value: avg,
      raw_data: {
        week_starting: ctx.weekStart,
        skus_counted: counts.length,
        avg_variance_pct: avg,
      },
    },
  ];
}

// ============================================
// WATCH (CEO-only diagnostic)
// ============================================

async function computeWatchRtsRate(ctx: ComputeContext): Promise<KpiComputation[]> {
  const { data: rows } = await fetchAllRows<{
    is_returned: boolean | null;
    is_delivered: boolean | null;
  }>(
    () =>
      ctx.sb
        .from("jt_deliveries")
        .select("is_returned, is_delivered, submission_date")
        .gte("submission_date", ctx.windowStart14 + "T00:00:00Z")
        .lte("submission_date", ctx.asOfDate + "T23:59:59Z"),
    { orderColumn: "submission_date", ascending: false },
  );

  const total = (rows ?? []).length;
  const returned = (rows ?? []).filter((r) => r.is_returned === true).length;
  const value = total > 0 ? (returned / total) * 100 : 0;

  return [
    {
      kpi_key: "watch_rts_rate_14d",
      scope: "watch" as const,
      employee_id: null,
      value,
      raw_data: {
        window_start: ctx.windowStart14,
        window_end: ctx.asOfDate,
        total_shipments: total,
        returned: returned,
      },
    },
  ];
}
