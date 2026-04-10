import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { matchAdToStore } from "@/lib/profit/store-matching";
import type { DailyPnlRow, ProfitSummary, ProfitDateFilter } from "@/lib/profit/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";
const FB_API_BASE = "https://graph.facebook.com/v21.0";

// In-memory cache — survives across requests while server is running
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeFilter = searchParams.get("store") || "ALL";
  const dateFilter = (searchParams.get("date_filter") || "today") as ProfitDateFilter;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const forceRefresh = searchParams.get("refresh") === "1";

  // Cache check
  const cacheKey = `pnl-${dateFilter}-${storeFilter}-${dateFrom}-${dateTo}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json(cached.data);
  }

  const supabase = await createClient();
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
      : storesData.filter((s) => s.name === storeFilter);

  // --- 2. Fetch COGS lookup ---
  const { data: cogsData } = await supabase.from("cogs_items").select("store_name, sku, cogs_per_unit");

  const cogsMap = new Map<string, number>();
  for (const item of cogsData || []) {
    const key = `${item.store_name}::${(item.sku || "").toLowerCase()}`;
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
          const key = `${dateStr}::${store.name}`;

          // Revenue
          const price = parseFloat(order.total_price) || 0;
          revenueByDateStore.set(key, (revenueByDateStore.get(key) || 0) + price);
          orderCountByDateStore.set(key, (orderCountByDateStore.get(key) || 0) + 1);

          // COGS from line items
          for (const li of order.line_items || []) {
            const sku = (li.sku || "").toLowerCase();
            if (!sku) continue;
            const cogsKey = `${store.name}::${sku}`;
            const cogsPerUnit = cogsMap.get(cogsKey);
            if (cogsPerUnit != null) {
              cogsByDateStore.set(
                key,
                (cogsByDateStore.get(key) || 0) + cogsPerUnit * li.quantity
              );
            } else {
              missingCogsSkus.add(`${store.name}::${li.sku}`);
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

              // If store filter is active and this ad doesn't match, skip
              if (storeFilter !== "ALL" && storeName !== storeFilter) continue;

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

  try {
    let jtQuery = supabase
      .from("jt_deliveries")
      .select("submission_date, store_name, shipping_cost, item_value, is_delivered, is_returned")
      .gte("submission_date", startDate)
      .lte("submission_date", endDate);

    if (storeFilter !== "ALL") {
      jtQuery = jtQuery.eq("store_name", storeFilter);
    }

    const { data: jtData, error: jtError } = await jtQuery;

    if (jtError) {
      warnings.push(`J&T data: ${jtError.message}`);
    } else {
      for (const row of jtData || []) {
        if (!row.submission_date) continue;
        const d = new Date(row.submission_date);
        if (isNaN(d.getTime())) continue;
        const dateStr = d.toISOString().split("T")[0];
        const key = `${dateStr}::${row.store_name || "UNKNOWN"}`;

        if (row.is_delivered) {
          shippingByDateStore.set(
            key,
            (shippingByDateStore.get(key) || 0) + (parseFloat(row.shipping_cost) || 0)
          );
        }
        if (row.is_returned) {
          returnsByDateStore.set(
            key,
            (returnsByDateStore.get(key) || 0) + (parseFloat(row.item_value) || 0)
          );
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`J&T: ${message}`);
  }

  // --- 5b. RTS worst-case rule: assume 25% RTS until 200+ delivered parcels per store ---
  // Fetch total delivered count per store (ALL TIME, not just date range)
  const rtsMinRate = 0.25; // 25% worst case
  const rtsMinDelivered = 200; // threshold to use actual rate

  try {
    // Lightweight query: just count delivered per store (not all rows)
    const { data: deliveredCounts } = await supabase
      .from("jt_deliveries")
      .select("store_name")
      .eq("is_delivered", true);

    if (deliveredCounts && deliveredCounts.length > 0) {
      // Count delivered per store
      const storeDelivered = new Map<string, number>();
      for (const row of deliveredCounts) {
        const store = row.store_name || "UNKNOWN";
        storeDelivered.set(store, (storeDelivered.get(store) || 0) + 1);
      }

      // For each store, if delivered < 200, override returns to be at least 25% of revenue
      const allStoresInData = new Set<string>();
      for (const key of revenueByDateStore.keys()) {
        allStoresInData.add(key.split("::")[1]);
      }

      for (const store of allStoresInData) {
        const delivered = storeDelivered.get(store) || 0;
        if (delivered < rtsMinDelivered) {
          // Calculate what 25% RTS would look like for this store in the date range
          // Sum revenue for this store in the date range
          let storeRevenue = 0;
          for (const [key, value] of revenueByDateStore) {
            if (key.endsWith(`::${store}`)) storeRevenue += value;
          }

          const worstCaseReturns = storeRevenue * rtsMinRate;

          // Sum actual returns for this store in date range
          let actualReturns = 0;
          for (const [key, value] of returnsByDateStore) {
            if (key.endsWith(`::${store}`)) actualReturns += value;
          }

          // If worst case is higher, distribute the difference across the store's dates
          if (worstCaseReturns > actualReturns && storeRevenue > 0) {
            const diff = worstCaseReturns - actualReturns;
            // Find all dates this store has revenue
            const storeDates: string[] = [];
            for (const key of revenueByDateStore.keys()) {
              if (key.endsWith(`::${store}`)) storeDates.push(key);
            }
            if (storeDates.length > 0) {
              // Distribute proportionally by revenue
              for (const key of storeDates) {
                const dateRevenue = revenueByDateStore.get(key) || 0;
                const proportion = dateRevenue / storeRevenue;
                const addedReturns = diff * proportion;
                returnsByDateStore.set(
                  key,
                  (returnsByDateStore.get(key) || 0) + addedReturns
                );
              }
            }
            warnings.push(`${store}: Using 25% worst-case RTS (${delivered}/${rtsMinDelivered} delivered)`);
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

  // Build final daily array
  const daily: DailyPnlRow[] = [];
  for (const [date, row] of dailyMap) {
    const netProfit =
      row.revenue - row.cogs - row.ad_spend - row.shipping - row.returns_value;
    const marginPct =
      row.revenue > 0 ? Math.round((netProfit / row.revenue) * 10000) / 100 : 0;

    daily.push({
      date,
      revenue: Math.round(row.revenue * 100) / 100,
      order_count: row.order_count,
      cogs: Math.round(row.cogs * 100) / 100,
      ad_spend: Math.round(row.ad_spend * 100) / 100,
      shipping: Math.round(row.shipping * 100) / 100,
      returns_value: Math.round(row.returns_value * 100) / 100,
      net_profit: Math.round(netProfit * 100) / 100,
      margin_pct: marginPct,
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

  summary.net_profit =
    summary.revenue -
    summary.cogs -
    summary.ad_spend -
    summary.shipping -
    summary.returns_value;
  summary.margin_pct =
    summary.revenue > 0
      ? Math.round((summary.net_profit / summary.revenue) * 10000) / 100
      : 0;

  // Round summary values
  summary.revenue = Math.round(summary.revenue * 100) / 100;
  summary.cogs = Math.round(summary.cogs * 100) / 100;
  summary.ad_spend = Math.round(summary.ad_spend * 100) / 100;
  summary.shipping = Math.round(summary.shipping * 100) / 100;
  summary.returns_value = Math.round(summary.returns_value * 100) / 100;
  summary.net_profit = Math.round(summary.net_profit * 100) / 100;

  const responseData = {
    summary,
    daily,
    stores: Array.from(allStoreNames).sort(),
    missing_cogs_skus: Array.from(missingCogsSkus).sort(),
    warnings,
  };

  // Cache the response
  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json(responseData);
}
