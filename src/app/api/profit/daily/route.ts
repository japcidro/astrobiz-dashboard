import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { matchAdToStore } from "@/lib/profit/store-matching";
import {
  calculateNetProfit,
  calculateMarginPct,
  calculateInTransitProjectedReturns,
  roundCurrency,
  SHIPPING_RATE,
  RTS_WORST_CASE_RATE,
  RTS_MIN_DELIVERED,
} from "@/lib/profit/formulas";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "@/lib/data-cache";
import type { DailyPnlRow, ProfitSummary, ProfitDateFilter } from "@/lib/profit/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";
const FB_API_BASE = "https://graph.facebook.com/v21.0";

// ---------- Date helpers (PHT +08:00) ----------

function computeDateRange(
  dateFilter: ProfitDateFilter,
  dateFrom?: string | null,
  dateTo?: string | null
): { startDate: string; endDate: string; createdAtMin: string; createdAtMax: string } {
  const PH_OFFSET = "+08:00";
  const nowUtc = new Date();
  const phNow = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const phYear = phNow.getUTCFullYear();
  const phMonth = phNow.getUTCMonth();
  const phDate = phNow.getUTCDate();

  function phDateStr(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function phStartOfDay(y: number, m: number, d: number): string {
    return `${phDateStr(y, m, d)}T00:00:00${PH_OFFSET}`;
  }

  function phEndOfDay(y: number, m: number, d: number): string {
    return `${phDateStr(y, m, d)}T23:59:59${PH_OFFSET}`;
  }

  const todayStr = phDateStr(phYear, phMonth, phDate);

  switch (dateFilter) {
    case "today":
      return {
        startDate: todayStr,
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, phMonth, phDate),
        createdAtMax: nowUtc.toISOString(),
      };

    case "yesterday": {
      const y = new Date(phNow.getTime() - 24 * 60 * 60 * 1000);
      const ys = phDateStr(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate());
      return {
        startDate: ys,
        endDate: ys,
        createdAtMin: phStartOfDay(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()),
        createdAtMax: phEndOfDay(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()),
      };
    }

    case "last_7d": {
      const d = new Date(phNow.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        startDate: phDateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        endDate: todayStr,
        createdAtMin: phStartOfDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "this_month":
      return {
        startDate: phDateStr(phYear, phMonth, 1),
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, phMonth, 1),
        createdAtMax: nowUtc.toISOString(),
      };

    case "last_month": {
      const firstOfThisMonth = new Date(Date.UTC(phYear, phMonth, 1));
      const lastMonth = new Date(firstOfThisMonth.getTime() - 1);
      const lmYear = lastMonth.getUTCFullYear();
      const lmMonth = lastMonth.getUTCMonth();
      const lmLastDay = lastMonth.getUTCDate();
      return {
        startDate: phDateStr(lmYear, lmMonth, 1),
        endDate: phDateStr(lmYear, lmMonth, lmLastDay),
        createdAtMin: phStartOfDay(lmYear, lmMonth, 1),
        createdAtMax: phEndOfDay(lmYear, lmMonth, lmLastDay),
      };
    }

    case "last_30d": {
      const d = new Date(phNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        startDate: phDateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        endDate: todayStr,
        createdAtMin: phStartOfDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "last_90d": {
      const d = new Date(phNow.getTime() - 90 * 24 * 60 * 60 * 1000);
      return {
        startDate: phDateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        endDate: todayStr,
        createdAtMin: phStartOfDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "custom":
      return {
        startDate: dateFrom || todayStr,
        endDate: dateTo || todayStr,
        createdAtMin: dateFrom ? `${dateFrom}T00:00:00${PH_OFFSET}` : nowUtc.toISOString(),
        createdAtMax: dateTo ? `${dateTo}T23:59:59${PH_OFFSET}` : nowUtc.toISOString(),
      };

    default:
      return {
        startDate: todayStr,
        endDate: todayStr,
        createdAtMin: phStartOfDay(phYear, phMonth, phDate),
        createdAtMax: nowUtc.toISOString(),
      };
  }
}

// ---------- Shopify paginated fetch ----------

interface RawShopifyOrderForPnl {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  financial_status: string;
  cancelled_at: string | null;
  line_items: {
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string | null;
  }[];
}

async function shopifyFetchOrders(
  storeUrl: string,
  apiToken: string,
  createdAtMin: string,
  createdAtMax: string
): Promise<RawShopifyOrderForPnl[]> {
  const allOrders: RawShopifyOrderForPnl[] = [];
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: "any",
      created_at_min: createdAtMin,
      created_at_max: createdAtMax,
      limit: "250",
      fields: "id,name,created_at,total_price,line_items,financial_status,cancelled_at",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    allOrders.push(...(json.orders || []));

    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return allOrders;
}

// ---------- Facebook insights fetch (daily breakdown) ----------

interface FbDailyInsight {
  campaign_name: string;
  adset_name: string;
  spend: string;
  date_start: string;
  date_stop: string;
}

async function fbFetchInsightsDaily(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<FbDailyInsight[]> {
  const allData: FbDailyInsight[] = [];
  let fetchUrl =
    `${FB_API_BASE}/act_${accountId}/insights?` +
    new URLSearchParams({
      access_token: token,
      fields: "campaign_name,adset_name,spend",
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });

  while (fetchUrl) {
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: { message?: string } }).error?.message ||
          `FB API error: ${res.status}`
      );
    }
    const json = await res.json();
    allData.push(...(json.data || []));
    fetchUrl = json.paging?.next || "";
  }

  return allData;
}

// ---------- Helper to get PHT date string from ISO ----------

function toPhtDateStr(isoString: string): string {
  const d = new Date(isoString);
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, "0")}-${String(pht.getUTCDate()).padStart(2, "0")}`;
}

// ---------- Main handler ----------

export async function GET(request: Request) {
  // Allow cron jobs to bypass auth using CRON_SECRET
  const isCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    const employee = await getEmployee();
    if (!employee) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (employee.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const storeFilter = searchParams.get("store") || "ALL";
  const dateFilter = (searchParams.get("date_filter") || "today") as ProfitDateFilter;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const forceRefresh = searchParams.get("refresh") === "1";

  // Cron invocations have no user session — use service client
  // so RLS on shopify_stores / app_settings doesn't silently return empty.
  const supabase = isCron ? createServiceClient() : await createClient();

  // Check Supabase cache first (skip on force refresh)
  const cacheKey = buildCacheKey("pnl", {
    store: storeFilter,
    date_filter: dateFilter,
    date_from: dateFrom || "",
    date_to: dateTo || "",
  });

  if (!forceRefresh) {
    const cached = await getCachedResponse(supabase, cacheKey);
    if (cached) {
      return Response.json({
        ...(cached.data as Record<string, unknown>),
        refreshed_at: cached.refreshed_at,
        from_cache: true,
      });
    }
  }
  const warnings: string[] = [];

  const { startDate, endDate, createdAtMin, createdAtMax } = computeDateRange(
    dateFilter,
    dateFrom,
    dateTo
  );

  // --- 1. Fetch active Shopify stores ---
  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData) {
    return Response.json(
      { error: storesError?.message || "Failed to load stores" },
      { status: 500 }
    );
  }

  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.name.toUpperCase() === storeFilter.toUpperCase());

  // --- 2. Fetch COGS lookup ---
  const { data: cogsData } = await supabase.from("cogs_items").select("store_name, sku, cogs_per_unit");

  const cogsMap = new Map<string, number>();
  for (const item of cogsData || []) {
    const key = `${(item.store_name || "").toUpperCase()}::${(item.sku || "").toLowerCase()}`;
    cogsMap.set(key, item.cogs_per_unit);
  }

  // --- 3. Fetch Shopify orders (revenue + COGS) ---
  // Per-date, per-store aggregation
  const revenueByDateStore = new Map<string, number>();
  const orderCountByDateStore = new Map<string, number>();
  const cogsByDateStore = new Map<string, number>();
  const missingCogsSkus = new Set<string>();

  await Promise.all(
    targetStores.map(async (store) => {
      try {
        const rawOrders = await shopifyFetchOrders(
          store.store_url,
          store.api_token,
          createdAtMin,
          createdAtMax
        );

        for (const order of rawOrders) {
          // Filter out cancelled/voided orders
          if (order.cancelled_at) continue;
          if (
            order.financial_status === "voided" ||
            order.financial_status === "refunded"
          )
            continue;

          const dateStr = toPhtDateStr(order.created_at);
          const normalizedStore = store.name.toUpperCase();
          const key = `${dateStr}::${normalizedStore}`;

          // Revenue
          const price = parseFloat(order.total_price) || 0;
          revenueByDateStore.set(key, (revenueByDateStore.get(key) || 0) + price);
          orderCountByDateStore.set(key, (orderCountByDateStore.get(key) || 0) + 1);

          // COGS from line items
          for (const li of order.line_items || []) {
            const sku = (li.sku || "").toLowerCase();
            if (!sku) continue;
            const cogsKey = `${normalizedStore}::${sku}`;
            const cogsPerUnit = cogsMap.get(cogsKey);
            if (cogsPerUnit != null) {
              cogsByDateStore.set(
                key,
                (cogsByDateStore.get(key) || 0) + cogsPerUnit * li.quantity
              );
            } else {
              missingCogsSkus.add(`${normalizedStore}::${li.sku}`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[PnL Shopify] Failed for store "${store.name}":`, message);
        warnings.push(`Shopify ${store.name}: ${message}`);
      }
    })
  );

  // --- 4. Fetch Facebook ad spend (daily breakdown) ---
  const adSpendByDateStore = new Map<string, number>();

  try {
    const { data: tokenSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single();

    const { data: selectedSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_selected_accounts")
      .single();

    if (tokenSetting?.value) {
      const fbToken = tokenSetting.value;
      let accountIds: string[] = [];
      try {
        accountIds = selectedSetting?.value
          ? JSON.parse(selectedSetting.value)
          : [];
      } catch {
        accountIds = [];
      }

      // Strip "act_" prefix if present — the fetch function adds it
      const cleanIds = accountIds.map((id: string) =>
        id.replace(/^act_/, "")
      );

      await Promise.all(
        cleanIds.map(async (accountId: string) => {
          try {
            const insights = await fbFetchInsightsDaily(
              accountId,
              fbToken,
              startDate,
              endDate
            );

            for (const row of insights) {
              const spend = parseFloat(row.spend || "0");
              if (spend === 0) continue;

              const dateStr = row.date_start; // already YYYY-MM-DD
              const storeName = matchAdToStore(
                row.campaign_name || "",
                row.adset_name || ""
              );

              // If store filter is active and this ad doesn't match, skip (case-insensitive)
              if (storeFilter !== "ALL" && storeName.toUpperCase() !== storeFilter.toUpperCase()) continue;

              const key = storeName
                ? `${dateStr}::${storeName}`
                : `${dateStr}::UNATTRIBUTED`;

              adSpendByDateStore.set(
                key,
                (adSpendByDateStore.get(key) || 0) + spend
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error(`[PnL FB] Failed for account ${accountId}:`, message);
            warnings.push(`Facebook act_${accountId}: ${message}`);
          }
        })
      );
    } else {
      warnings.push("Facebook token not configured — ad spend excluded.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`Facebook: ${message}`);
  }

  // --- 5. Fetch J&T delivery data ---
  const shippingByDateStore = new Map<string, number>();
  const returnsByDateStore = new Map<string, number>();
  const inTransitByDate = new Map<string, number>();

  try {
    // submission_date is stored as ISO UTC (e.g. "2026-04-11T16:00:00.000Z")
    // but startDate/endDate are PHT date strings (e.g. "2026-04-12").
    // Convert to UTC boundaries so parcels near midnight aren't excluded.
    const jtStartUtc = `${startDate}T00:00:00+08:00`;
    const jtEndUtc = `${endDate}T23:59:59+08:00`;

    let jtQuery = supabase
      .from("jt_deliveries")
      .select("submission_date, store_name, shipping_cost, item_value, cod_amount, is_delivered, is_returned, classification")
      .gte("submission_date", jtStartUtc)
      .lte("submission_date", jtEndUtc);

    if (storeFilter !== "ALL") {
      jtQuery = jtQuery.ilike("store_name", storeFilter);
    }

    const { data: jtData, error: jtError } = await jtQuery;

    if (jtError) {
      warnings.push(`J&T data: ${jtError.message}`);
    } else {
      for (const row of jtData || []) {
        if (!row.submission_date) continue;
        const d = new Date(row.submission_date);
        if (isNaN(d.getTime())) continue;
        // Convert to PHT date to match Shopify/FB date grouping
        const dateStr = toPhtDateStr(row.submission_date);
        const key = `${dateStr}::${(row.store_name || "UNKNOWN").toUpperCase()}`;

        if (row.is_delivered) {
          shippingByDateStore.set(
            key,
            (shippingByDateStore.get(key) || 0) + (parseFloat(row.shipping_cost) || 0)
          );
        }
        if (row.is_returned) {
          // Returns cost = lost revenue (COD amount customer didn't pay) + wasted shipping
          // Use cod_amount (actual selling price) over item_value (declared/insured value)
          const codAmount = parseFloat(row.cod_amount) || 0;
          const itemValue = parseFloat(row.item_value) || 0;
          const lostRevenue = codAmount > 0 ? codAmount : itemValue;
          const shipCost = parseFloat(row.shipping_cost) || 0;
          returnsByDateStore.set(
            key,
            (returnsByDateStore.get(key) || 0) + lostRevenue + shipCost
          );
        }
        // Count in-transit parcels per submission date
        if (row.classification === "In Transit" || row.classification === "Pending") {
          inTransitByDate.set(dateStr, (inTransitByDate.get(dateStr) || 0) + 1);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`J&T: ${message}`);
  }

  // --- 5b. RTS projection: two strategies depending on data maturity ---
  //   < 200 delivered: 25% worst-case of revenue (conservative)
  //   >= 200 delivered: project returns from in-transit parcels using actual RTS rate
  const returnsProjectedDates = new Set<string>();

  try {
    // Fetch ALL-TIME delivery stats per store (delivered, returned, in-transit)
    const { data: allJtRows } = await supabase
      .from("jt_deliveries")
      .select("store_name, is_delivered, is_returned, classification, cod_amount, shipping_cost");

    if (allJtRows && allJtRows.length > 0) {
      // Aggregate per store
      const storeStats = new Map<string, {
        delivered: number;
        returned: number;
        inTransit: number;
        totalReturnCod: number;
        totalReturnShip: number;
      }>();

      for (const row of allJtRows) {
        const store = (row.store_name || "UNKNOWN").toUpperCase();
        if (!storeStats.has(store)) {
          storeStats.set(store, { delivered: 0, returned: 0, inTransit: 0, totalReturnCod: 0, totalReturnShip: 0 });
        }
        const stats = storeStats.get(store)!;

        if (row.is_delivered) stats.delivered++;
        if (row.is_returned) {
          stats.returned++;
          stats.totalReturnCod += parseFloat(row.cod_amount) || 0;
          stats.totalReturnShip += parseFloat(row.shipping_cost) || 0;
        }
        if (row.classification === "In Transit" || row.classification === "Pending") {
          stats.inTransit++;
        }
      }

      // Get all stores present in revenue data
      const allStoresInData = new Set<string>();
      for (const key of revenueByDateStore.keys()) {
        allStoresInData.add(key.split("::")[1]);
      }

      for (const store of allStoresInData) {
        const stats = storeStats.get(store);
        const delivered = stats?.delivered || 0;
        const returned = stats?.returned || 0;
        const settled = delivered + returned;

        // Sum actual returns already counted for this store in date range
        let actualReturns = 0;
        for (const [key, value] of returnsByDateStore) {
          if (key.endsWith(`::${store}`)) actualReturns += value;
        }

        // Sum revenue for this store in date range
        let storeRevenue = 0;
        for (const [key, value] of revenueByDateStore) {
          if (key.endsWith(`::${store}`)) storeRevenue += value;
        }

        let additionalReturns = 0;

        if (settled < RTS_MIN_DELIVERED) {
          // Strategy A: not enough data — use 25% worst-case of revenue
          const worstCase = storeRevenue * RTS_WORST_CASE_RATE;
          if (worstCase > actualReturns) {
            additionalReturns = worstCase - actualReturns;
            warnings.push(`${store}: Using 25% worst-case RTS (${settled}/${RTS_MIN_DELIVERED} settled)`);
          }
        } else {
          // Strategy B: enough data — project returns from in-transit using actual RTS rate
          const inTransit = stats?.inTransit || 0;
          if (inTransit > 0) {
            const avgCod = returned > 0 ? (stats!.totalReturnCod / returned) : 0;
            const avgShip = returned > 0 ? (stats!.totalReturnShip / returned) : 0;
            const { projectedReturns, projectedRtsRate } = calculateInTransitProjectedReturns(
              delivered, returned, inTransit, avgCod, avgShip
            );
            if (projectedReturns > 0) {
              additionalReturns = projectedReturns;
              const rtsPct = Math.round(projectedRtsRate * 1000) / 10;
              warnings.push(`${store}: +₱${Math.round(projectedReturns).toLocaleString()} projected returns from ${inTransit} in-transit parcels (${rtsPct}% RTS rate)`);
            }
          }
        }

        // Distribute additional returns proportionally by revenue across dates
        if (additionalReturns > 0 && storeRevenue > 0) {
          const storeDates: string[] = [];
          for (const key of revenueByDateStore.keys()) {
            if (key.endsWith(`::${store}`)) storeDates.push(key);
          }
          for (const key of storeDates) {
            const dateRevenue = revenueByDateStore.get(key) || 0;
            const proportion = dateRevenue / storeRevenue;
            const added = additionalReturns * proportion;
            returnsByDateStore.set(key, (returnsByDateStore.get(key) || 0) + added);
            returnsProjectedDates.add(key.split("::")[0]);
          }
        }
      }
    }
  } catch {
    // Non-critical — continue with actual returns data
  }

  // --- 6. Aggregate per day ---
  const allDates = new Set<string>();
  const allStoreNames = new Set<string>();

  for (const key of [
    ...revenueByDateStore.keys(),
    ...adSpendByDateStore.keys(),
    ...shippingByDateStore.keys(),
    ...returnsByDateStore.keys(),
  ]) {
    const [date, store] = key.split("::");
    allDates.add(date);
    if (store && store !== "UNATTRIBUTED" && store !== "UNKNOWN") {
      allStoreNames.add(store);
    }
  }

  // Build daily rows aggregated across all stores
  const dailyMap = new Map<
    string,
    {
      revenue: number;
      order_count: number;
      cogs: number;
      ad_spend: number;
      shipping: number;
      returns_value: number;
    }
  >();

  for (const date of allDates) {
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        revenue: 0,
        order_count: 0,
        cogs: 0,
        ad_spend: 0,
        shipping: 0,
        returns_value: 0,
      });
    }
  }

  // Aggregate all date::store keys into per-date totals
  for (const [key, value] of revenueByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.revenue += value;
  }
  for (const [key, value] of orderCountByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.order_count += value;
  }
  for (const [key, value] of cogsByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.cogs += value;
  }
  for (const [key, value] of adSpendByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.ad_spend += value;
  }
  for (const [key, value] of shippingByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.shipping += value;
  }
  for (const [key, value] of returnsByDateStore) {
    const date = key.split("::")[0];
    const row = dailyMap.get(date);
    if (row) row.returns_value += value;
  }

  // --- 6b. Shipping: always use 12% of revenue as projected estimate ---
  for (const [, row] of dailyMap) {
    if (row.revenue > 0) {
      row.shipping = row.revenue * SHIPPING_RATE;
    }
  }

  // Build final daily array
  const daily: DailyPnlRow[] = [];
  for (const [date, row] of dailyMap) {
    const shippingProjected = true; // always projected (12% of revenue)
    const returnsProjected = returnsProjectedDates.has(date);
    const netProfit = calculateNetProfit(
      row.revenue, row.cogs, row.ad_spend, row.shipping, row.returns_value
    );
    const marginPct = calculateMarginPct(netProfit, row.revenue);

    daily.push({
      date,
      revenue: roundCurrency(row.revenue),
      order_count: row.order_count,
      cogs: roundCurrency(row.cogs),
      ad_spend: roundCurrency(row.ad_spend),
      shipping: roundCurrency(row.shipping),
      returns_value: roundCurrency(row.returns_value),
      net_profit: roundCurrency(netProfit),
      margin_pct: marginPct,
      shipping_projected: shippingProjected,
      returns_projected: returnsProjected,
      in_transit_count: inTransitByDate.get(date) || 0,
    });
  }

  // Sort by date descending
  daily.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

  // --- 7. Summary totals ---
  const summary: ProfitSummary = {
    revenue: 0,
    order_count: 0,
    cogs: 0,
    ad_spend: 0,
    shipping: 0,
    returns_value: 0,
    net_profit: 0,
    margin_pct: 0,
  };

  for (const row of daily) {
    summary.revenue += row.revenue;
    summary.order_count += row.order_count;
    summary.cogs += row.cogs;
    summary.ad_spend += row.ad_spend;
    summary.shipping += row.shipping;
    summary.returns_value += row.returns_value;
  }

  summary.net_profit = calculateNetProfit(
    summary.revenue, summary.cogs, summary.ad_spend, summary.shipping, summary.returns_value
  );
  summary.margin_pct = calculateMarginPct(summary.net_profit, summary.revenue);

  // Round summary values
  summary.revenue = roundCurrency(summary.revenue);
  summary.cogs = roundCurrency(summary.cogs);
  summary.ad_spend = roundCurrency(summary.ad_spend);
  summary.shipping = roundCurrency(summary.shipping);
  summary.returns_value = roundCurrency(summary.returns_value);
  summary.net_profit = roundCurrency(summary.net_profit);

  const responseData = {
    summary,
    daily,
    stores: Array.from(allStoreNames).sort(),
    missing_cogs_skus: Array.from(missingCogsSkus).sort(),
    warnings,
  };

  // Write to Supabase cache (non-blocking)
  const refreshedAt = new Date().toISOString();
  setCachedResponse(supabase, "pnl", cacheKey, responseData).catch(() => {});

  return Response.json({ ...responseData, refreshed_at: refreshedAt });
}
