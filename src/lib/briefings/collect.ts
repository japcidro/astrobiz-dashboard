import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BriefingData,
  BriefingType,
  PeriodRange,
  StoreBreakdown,
  TopAd,
  TopProduct,
  AutopilotSummary,
  RtsSummary,
  StockMovement,
  TeamHours,
} from "./types";
import { phtDateString } from "./period";

interface AdRow {
  ad_id: string;
  ad: string;
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
}

interface ProfitRow {
  date: string;
  revenue: number;
  order_count: number;
  cogs: number;
  ad_spend: number;
  shipping: number;
  returns_value: number;
  net_profit: number;
}

interface OrdersPayload {
  orders?: Array<{
    store_name: string;
    total_price: string;
    fulfillment_status: string | null;
    age_days: number;
    cancelled_at: string | null;
    line_items: Array<{
      sku: string | null;
      title: string;
      quantity: number;
      price: string;
    }>;
  }>;
  summary?: {
    total_orders: number;
    total_revenue: number;
    unfulfilled_count: number;
    fulfilled_count: number;
    aging_warning_count: number;
    aging_danger_count: number;
  };
}

// 60s was too tight: morning cron fires 3 data-heavy endpoints
// simultaneously on cold functions, and profit/daily alone can
// cascade through 3 stores' Shopify orders + FB insights. Bump
// to 180s and retry once so a single slow cold start doesn't
// silently zero out the briefing.
async function safeFetch<T>(
  url: string,
  cronSecret: string,
  attempt = 1
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      console.error(
        `[briefings] ${url} returned ${res.status} (attempt ${attempt})`
      );
      if (attempt === 1 && (res.status >= 500 || res.status === 408)) {
        return safeFetch<T>(url, cronSecret, 2);
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[briefings] ${url} error (attempt ${attempt}):`, message);
    // Retry once on timeout / network blip. Second failure = give up
    // so we don't stall the whole cron.
    if (attempt === 1) {
      return safeFetch<T>(url, cronSecret, 2);
    }
    return null;
  }
}

export async function collectBriefingData(
  supabase: SupabaseClient,
  baseUrl: string,
  cronSecret: string,
  type: BriefingType,
  period: PeriodRange
): Promise<BriefingData> {
  // 1. P&L from /api/profit/daily — refresh=1 bypasses stale cache that
  // may have been populated before the RLS fix landed.
  const pnlPromise = safeFetch<{
    rows: ProfitRow[];
    summary: {
      revenue: number;
      order_count: number;
      cogs: number;
      ad_spend: number;
      shipping: number;
      returns_value: number;
      net_profit: number;
    };
  }>(
    `${baseUrl}/api/profit/daily?${new URLSearchParams({
      store: "ALL",
      date_filter: period.dateFilter,
      refresh: "1",
    })}`,
    cronSecret
  );

  // 2. Ads
  const adsPromise = safeFetch<{ ads?: AdRow[]; totals?: { spend: number; roas: number; cpa: number; purchases: number } }>(
    `${baseUrl}/api/facebook/all-ads?${new URLSearchParams({
      date_preset: period.datePreset,
      account: "ALL",
      refresh: "1",
    })}`,
    cronSecret
  );

  // 3. Orders (for unfulfilled/aging + top products)
  const ordersPromise = safeFetch<OrdersPayload>(
    `${baseUrl}/api/shopify/orders?${new URLSearchParams({
      store: "ALL",
      date_filter: period.dateFilter,
      refresh: "1",
    })}`,
    cronSecret
  );

  const [pnl, adsData, ordersData] = await Promise.all([pnlPromise, adsPromise, ordersPromise]);

  // --- Assemble basic P&L numbers ---
  const revenue = pnl?.summary.revenue ?? 0;
  const orders = pnl?.summary.order_count ?? ordersData?.summary?.total_orders ?? 0;
  const adSpend = pnl?.summary.ad_spend ?? adsData?.totals?.spend ?? 0;
  const netProfitEst = pnl?.summary.net_profit ?? 0;

  // Prefer FB's reported ROAS (pixel-attributed), but fall back to blended
  // (Shopify revenue / ad spend) when FB reports 0 — common when the pixel
  // or CAPI isn't wired to capture purchase events.
  const fbRoas = adsData?.totals?.roas ?? 0;
  const blendedRoas = adSpend > 0 ? revenue / adSpend : 0;
  const roas = fbRoas > 0 ? fbRoas : blendedRoas;

  const fbCpa = adsData?.totals?.cpa ?? 0;
  const blendedCpa = orders > 0 ? adSpend / orders : 0;
  const cpa = fbCpa > 0 ? fbCpa : blendedCpa;

  // --- Top ads (by ROAS among ads with spend) ---
  const ads = (adsData?.ads ?? []).filter((a) => a.spend >= 500);
  const top_ads: TopAd[] = [...ads]
    .sort((a, b) => b.roas * b.spend - a.roas * a.spend)
    .slice(0, 3)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad ?? a.ad_id,
      spend: a.spend,
      roas: a.roas,
      purchases: a.purchases,
      cpa: a.cpa,
    }));

  const worst_ads: TopAd[] = [...ads]
    .filter((a) => a.spend >= 1000 && a.purchases === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad ?? a.ad_id,
      spend: a.spend,
      roas: a.roas,
      purchases: a.purchases,
      cpa: a.cpa,
    }));

  // --- Top products from order line_items ---
  const productAgg = new Map<string, { units: number; revenue: number; store: string; title: string; sku: string | null }>();
  for (const order of ordersData?.orders ?? []) {
    if (order.cancelled_at) continue;
    for (const li of order.line_items ?? []) {
      const key = `${order.store_name}|${li.sku ?? li.title}`;
      const agg = productAgg.get(key) ?? {
        units: 0,
        revenue: 0,
        store: order.store_name,
        title: li.title,
        sku: li.sku,
      };
      agg.units += li.quantity;
      agg.revenue += Number(li.price) * li.quantity;
      productAgg.set(key, agg);
    }
  }
  const top_products: TopProduct[] = Array.from(productAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({
      sku: p.sku,
      product_title: p.title,
      store_name: p.store,
      units_sold: p.units,
      revenue: p.revenue,
    }));

  // --- Store breakdown ---
  const storeAgg = new Map<string, StoreBreakdown>();
  for (const order of ordersData?.orders ?? []) {
    if (order.cancelled_at) continue;
    const s = storeAgg.get(order.store_name) ?? {
      store_name: order.store_name,
      revenue: 0,
      orders: 0,
      unfulfilled: 0,
    };
    s.revenue += Number(order.total_price);
    s.orders++;
    if (!order.fulfillment_status) s.unfulfilled++;
    storeAgg.set(order.store_name, s);
  }
  const store_breakdown = Array.from(storeAgg.values()).sort(
    (a, b) => b.revenue - a.revenue
  );

  // --- Unfulfilled/aging from summary ---
  const unfulfilled_count = ordersData?.summary?.unfulfilled_count ?? 0;
  const aging_count =
    (ordersData?.summary?.aging_warning_count ?? 0) +
    (ordersData?.summary?.aging_danger_count ?? 0);
  const fulfilled_count = ordersData?.summary?.fulfilled_count ?? 0;

  // --- Autopilot ---
  const periodStartIso = period.start.toISOString();
  const periodEndIso = period.end.toISOString();
  const { data: autoRows } = await supabase
    .from("autopilot_actions")
    .select("action, spend")
    .gte("created_at", periodStartIso)
    .lte("created_at", periodEndIso)
    .eq("status", "ok")
    .in("action", ["paused", "resumed"]);

  const autopilot: AutopilotSummary = {
    paused: 0,
    resumed: 0,
    total_spend_affected: 0,
  };
  for (const row of (autoRows ?? []) as { action: string; spend: number | null }[]) {
    if (row.action === "paused") autopilot.paused++;
    else if (row.action === "resumed") autopilot.resumed++;
    autopilot.total_spend_affected += Number(row.spend ?? 0);
  }

  // --- RTS ---
  const periodStartDate = phtDateString(period.start);
  const periodEndDate = phtDateString(period.end);
  const { data: jtRows } = await supabase
    .from("jt_deliveries")
    .select("amount, classification, province")
    .gte("submission_date", periodStartDate)
    .lte("submission_date", periodEndDate);

  const rtsOnly = (jtRows ?? []).filter((r: { classification: string | null }) => {
    const c = (r.classification || "").toLowerCase();
    return c.includes("rts") || c.includes("return");
  }) as { amount: number | null; classification: string | null; province: string | null }[];

  const provinceCount = new Map<string, number>();
  for (const r of rtsOnly) {
    const p = r.province ?? "Unknown";
    provinceCount.set(p, (provinceCount.get(p) ?? 0) + 1);
  }
  const topProvince = Array.from(provinceCount.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const rts: RtsSummary = {
    rts_count: rtsOnly.length,
    rts_value: rtsOnly.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    top_province: topProvince,
  };

  // --- Stock movement (from inventory_snapshots) ---
  const { data: todaySnaps } = await supabase
    .from("inventory_snapshots")
    .select("store_name, sku, product_title, stock")
    .eq("snapshot_date", periodEndDate);

  const { data: startSnaps } = await supabase
    .from("inventory_snapshots")
    .select("store_name, sku, stock")
    .eq("snapshot_date", periodStartDate);

  const startMap = new Map<string, number>();
  for (const r of (startSnaps ?? []) as { store_name: string; sku: string | null; stock: number }[]) {
    startMap.set(`${r.store_name}|${r.sku ?? ""}`, r.stock);
  }
  const stock_movement: StockMovement[] = [];
  for (const r of (todaySnaps ?? []) as {
    store_name: string;
    sku: string | null;
    product_title: string | null;
    stock: number;
  }[]) {
    const startStock = startMap.get(`${r.store_name}|${r.sku ?? ""}`);
    if (startStock === undefined) continue;
    const delta = r.stock - startStock;
    if (Math.abs(delta) < 5) continue;
    stock_movement.push({
      product_title: r.product_title ?? r.sku ?? "Unknown",
      store_name: r.store_name,
      delta,
      stock_now: r.stock,
    });
  }
  stock_movement.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topStockMovement = stock_movement.slice(0, 5);

  // --- Team hours by role ---
  const { data: teamRows } = await supabase
    .from("time_entries")
    .select("total_seconds, employee_id, employees(role)")
    .gte("date", periodStartDate)
    .lte("date", periodEndDate);

  const roleAgg = new Map<string, number>();
  for (const row of (teamRows ?? []) as unknown as Array<{
    total_seconds: number | null;
    employees: { role: string } | { role: string }[] | null;
  }>) {
    const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const role = emp?.role ?? "unknown";
    roleAgg.set(role, (roleAgg.get(role) ?? 0) + Number(row.total_seconds ?? 0));
  }
  const team_hours: TeamHours[] = Array.from(roleAgg.entries())
    .map(([role, seconds]) => ({ role, hours: Number((seconds / 3600).toFixed(1)) }))
    .sort((a, b) => b.hours - a.hours);

  // --- Comparison period (delta %) ---
  const periodLenMs = period.end.getTime() - period.start.getTime() + 24 * 60 * 60 * 1000;
  const prevEnd = new Date(period.start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - periodLenMs + 24 * 60 * 60 * 1000);
  const prevPnl = await safeFetch<{ summary: { revenue: number; net_profit: number } }>(
    `${baseUrl}/api/profit/daily?${new URLSearchParams({
      store: "ALL",
      date_from: phtDateString(prevStart),
      date_to: phtDateString(prevEnd),
      refresh: "1",
    })}`,
    cronSecret
  );
  const revenue_delta_pct =
    prevPnl?.summary && prevPnl.summary.revenue > 0
      ? ((revenue - prevPnl.summary.revenue) / prevPnl.summary.revenue) * 100
      : null;
  const profit_delta_pct =
    prevPnl?.summary && prevPnl.summary.net_profit !== 0
      ? ((netProfitEst - prevPnl.summary.net_profit) / Math.abs(prevPnl.summary.net_profit)) * 100
      : null;

  return {
    revenue,
    orders,
    ad_spend: adSpend,
    net_profit_est: netProfitEst,
    roas,
    cpa,
    revenue_delta_pct,
    profit_delta_pct,
    unfulfilled_count,
    aging_count,
    fulfilled_count,
    top_products,
    top_ads,
    worst_ads,
    store_breakdown,
    autopilot,
    rts,
    stock_movement: topStockMovement,
    team_hours,
  };
}
