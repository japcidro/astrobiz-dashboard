import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { matchAdToStore } from "@/lib/profit/store-matching";
import {
  calculateNetProfit,
  calculateMarginPct,
  calculateUnshippedOrderReturns,
  calculateVoidAdjustmentFactor,
  settledFractionForAge,
  calculateShippingWithProjection,
  calculateAov,
  calculateCpp,
  roundCurrency,
  buildCogsMap,
  applyAdSpendVat,
  AD_SPEND_VAT_RATE,
  RTS_WORST_CASE_RATE,
  RTS_MIN_DELIVERED,
  SETTLEMENT_WINDOW_DAYS,
} from "@/lib/profit/formulas";
import {
  buildReturnHazardCurve,
  calculateTrailingRtsRate,
  isOutForDelivery,
  observationTimeMs,
  parcelAgeDays,
  regionForProvince,
  resolveParcelState,
  returnProbabilityForOpenParcel,
  DEFAULT_RETURN_HAZARD,
  RTS_RATE_WINDOW_DAYS,
  type ReturnHazardCurve,
  type TrailingRtsRate,
} from "@/lib/profit/jt-settlement";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "@/lib/data-cache";
import { fbFetchWithLimits } from "@/lib/facebook/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/paginate";

type JtDailyRow = {
  submission_date: string | null;
  shopify_order_date: string | null;
  shopify_order_id: string | null;
  store_name: string | null;
  province: string | null;
  updated_at: string | null;
  order_status: string | null;
  shipping_cost: number | string | null;
  item_value: number | string | null;
  cod_amount: number | string | null;
  is_delivered: boolean | null;
  is_returned: boolean | null;
  classification: string | null;
};

type JtStoreRtsRow = {
  store_name: string | null;
  submission_date: string | null;
  signing_time: string | null;
  province: string | null;
  classification: string | null;
  updated_at: string | null;
  is_delivered: boolean | null;
  is_returned: boolean | null;
  cod_amount: number | string | null;
  shipping_cost: number | string | null;
};
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
  account_name: string;
  campaign_name: string;
  adset_name: string;
  spend: string;
  date_start: string;
  date_stop: string;
}

// The refresh cron asks for every store × every date filter, and the store
// split happens in code from the same campaign rows, so one Facebook fetch
// per account and range serves all six store variants. Twenty minutes is
// shorter than the cron's cadence, so the cron still refreshes it.
const FB_DAILY_INSIGHTS_TTL_MS = 20 * 60 * 1000;

async function fbFetchInsightsDaily(
  accountId: string,
  token: string,
  since: string,
  until: string,
  db: SupabaseClient
): Promise<FbDailyInsight[]> {
  const cacheKey = `fb_daily_insights:${accountId}:${since}:${until}`;
  const cached = await getCachedResponse<FbDailyInsight[]>(db, cacheKey, FB_DAILY_INSIGHTS_TTL_MS).catch(() => null);
  if (cached) return cached.data;

  const allData: FbDailyInsight[] = [];
  let fetchUrl =
    `${FB_API_BASE}/act_${accountId}/insights?` +
    new URLSearchParams({
      access_token: token,
      fields: "account_name,campaign_name,adset_name,spend",
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });

  while (fetchUrl) {
    const res = await fbFetchWithLimits(fetchUrl, { cache: "no-store" }, db);
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

  void setCachedResponse(db, "fb_daily_insights", cacheKey, allData).catch(() => {});
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
  // Effective per-unit cost: the supplier price plus that SKU's VAT.
  const { data: cogsData } = await supabase
    .from("cogs_items")
    .select("store_name, sku, cogs_per_unit, vat_rate");
  const cogsMap = buildCogsMap(cogsData || []);

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

  // Today in PHT, used for per-date age calc. Computed independently from
  // computeDateRange so backfills (custom date_from/date_to in the past)
  // still measure age relative to NOW, not the requested period's end.
  const phNowForAge = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayPhtStr = `${phNowForAge.getUTCFullYear()}-${String(
    phNowForAge.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(phNowForAge.getUTCDate()).padStart(2, "0")}`;
  const todayPhtMs = new Date(`${todayPhtStr}T00:00:00+08:00`).getTime();
  function ageDaysForDate(dateStr: string): number {
    const d = new Date(`${dateStr}T00:00:00+08:00`).getTime();
    return Math.floor((todayPhtMs - d) / (1000 * 60 * 60 * 24));
  }

  // --- 3b. Void adjustment: discount revenue that is going to be cancelled ---
  //
  // Orders aren't cancelled when they're placed. An unconfirmed lead is deleted
  // 3+ days later, so a young date still counts revenue that will disappear —
  // and its COGS and its shipping with it. Left alone this overstated net
  // profit on the freshest date by 14% (I LOVE PATCHES) to 41% (FOLIQ).
  //
  // Scale revenue, order count and COGS by the store's measured void rate and
  // how much of that cancellation is still outstanding at this date's age.
  // Applied BEFORE the RTS projection below, which reads the order count.
  const voidAdjustedDates = new Set<string>();
  try {
    const { data: voidStats } = await supabase
      .from("store_void_stats")
      .select("store_name, void_rate, settlement_curve");

    const statsByStore = new Map<string, { rate: number; curve: number[] }>();
    for (const row of voidStats || []) {
      statsByStore.set(String(row.store_name).toUpperCase(), {
        rate: Number(row.void_rate) || 0,
        curve: (row.settlement_curve || []).map(Number),
      });
    }

    const adjustedByStore = new Map<string, number>();
    for (const key of Array.from(revenueByDateStore.keys())) {
      const [dateStr, storeName] = key.split("::");
      const stat = statsByStore.get(storeName);
      if (!stat || stat.rate <= 0) continue;

      const factor = calculateVoidAdjustmentFactor(
        stat.rate,
        settledFractionForAge(stat.curve, ageDaysForDate(dateStr))
      );
      if (factor >= 1) continue;

      const revenue = revenueByDateStore.get(key) || 0;
      adjustedByStore.set(
        storeName,
        (adjustedByStore.get(storeName) || 0) + revenue * (1 - factor)
      );

      revenueByDateStore.set(key, revenue * factor);
      cogsByDateStore.set(key, (cogsByDateStore.get(key) || 0) * factor);
      // Fractional orders are correct here — this is an expected value, and
      // rounding each date would bias the RTS projection that consumes it.
      orderCountByDateStore.set(key, (orderCountByDateStore.get(key) || 0) * factor);
      voidAdjustedDates.add(dateStr);
    }

    for (const [storeName, amount] of adjustedByStore) {
      if (amount < 1) continue;
      const stat = statsByStore.get(storeName)!;
      warnings.push(
        `${storeName}: -PHP ${Math.round(amount).toLocaleString()} revenue held back for expected cancellations (${(stat.rate * 100).toFixed(1)}% void rate)`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`Void adjustment skipped: ${message}`);
  }

  // --- 4. Fetch Facebook ad spend (daily breakdown) ---
  const adSpendByDateStore = new Map<string, number>();
  // Parcels seen per (date, store) — drives the shipping projection for
  // orders that haven't been picked-packed or uploaded yet.
  const parcelCountByDateStore = new Map<string, number>();

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
      // The insights cache and the rate-limit state are shared infrastructure
      // (admin-only under RLS), so they go through the service client.
      const fbDb = createServiceClient();
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
              endDate,
              fbDb
            );

            for (const row of insights) {
              // Meta reports the pre-VAT delivery cost; the 12% it bills on
              // top is real cash out, so the P&L charges it here.
              const spend = applyAdSpendVat(parseFloat(row.spend || "0"));
              if (spend === 0) continue;

              const dateStr = row.date_start; // already YYYY-MM-DD
              const storeName = matchAdToStore(
                row.campaign_name || "",
                row.adset_name || "",
                row.account_name || ""
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

  // --- 5. J&T parcels -------------------------------------------------------
  //
  // Two reads of jt_deliveries:
  //   (a) the whole table, for per-store statistics — average fee per parcel,
  //       the trailing RTS rate, the average COD of a return — and the return
  //       hazard curve (how likely a still-open parcel is to come back, by
  //       region and age);
  //   (b) the parcels that belong to the requested dates.
  //
  // Attribution for (b): prefer shopify_order_date when the parcel has been
  // linked back to its Shopify order (waybill ↔ tracking_number match). That
  // gives cohort-correct per-date margins — the row for date D shows revenue
  // from D's orders AND returns from those same orders, regardless of when
  // the J&T parcel was actually submitted (which lags 0-3 days behind order
  // creation due to pick-pack). Unmatched rows fall back to submission_date
  // so the data still surfaces, just less precisely.
  //
  // Each parcel is then settled on its own, as of the upload that last saw
  // it: delivered → nothing; returned, or in transit past its region's
  // cutoff → its COD is lost; still open → its COD × P(return | region, age
  // when seen) from the hazard curve, capped at the fresh-parcel rate when
  // J&T says the courier is out delivering it. "As of the upload" matters: a parcel
  // that was In Transit in Monday's file says nothing about Thursday, so its
  // age is frozen at Monday until a newer file is loaded (jt_data_as_of in
  // the response says how fresh the files are). This replaces the old "project from the order
  // count for 6 days, then trust the file" rule, which showed only 61–68% of
  // the final returns on dates 6–8 days old: Visayas/Mindanao returns take
  // ~10 days to be marked and their aged cutoff is 8, so for three days
  // nothing covered them.
  const shippingByDateStore = new Map<string, number>();
  const returnsByDateStore = new Map<string, number>();
  // The three pieces of returnsByDateStore, kept apart so the table can say
  // what is J&T fact and what is estimate.
  const returnsActualByDateStore = new Map<string, number>();
  const returnsInTransitByDateStore = new Map<string, number>();
  const returnsUnshippedByDateStore = new Map<string, number>();
  const inTransitByDate = new Map<string, number>();
  let jtDataAsOf: string | null = null;
  const returnsProjectedDates = new Set<string>();
  const shippingProjectedDates = new Set<string>();
  // Blended actual J&T fee per parcel, per store. The fee is zone-based
  // (PHP 78 Metro Manila -> PHP 259 far provinces), so each store's real mix
  // gives a far better estimate for unshipped orders than any flat rate.
  const storeAvgShipping = new Map<string, number>();
  const nowMs = Date.now();

  type StoreStats = {
    parcels: number;
    delivered: number;
    returned: number;
    totalReturnCod: number;
    rate: TrailingRtsRate;
  };
  const storeStats = new Map<string, StoreStats>();
  let hazard: ReturnHazardCurve = DEFAULT_RETURN_HAZARD;

  try {
    const jtStartUtc = `${startDate}T00:00:00+08:00`;
    const jtEndUtc = `${endDate}T23:59:59+08:00`;
    const jtFields =
      "submission_date, shopify_order_date, shopify_order_id, store_name, province, updated_at, order_status, shipping_cost, item_value, cod_amount, is_delivered, is_returned, classification";

    // Date-windowed queries can blow past PostgREST's 1000-row cap once
    // we're shipping >30 parcels/day across stores, and the whole-table read
    // always did. Drain everything via paginate.
    const [historyRes, matchedRes, unmatchedRes] = await Promise.all([
      fetchAllRows<JtStoreRtsRow>(
        () =>
          supabase
            .from("jt_deliveries")
            .select(
              "store_name, submission_date, signing_time, province, classification, updated_at, is_delivered, is_returned, cod_amount, shipping_cost"
            ),
        { orderColumn: "id", ascending: true }
      ),
      fetchAllRows<JtDailyRow>(
        () => {
          let q = supabase
            .from("jt_deliveries")
            .select(jtFields)
            .not("shopify_order_id", "is", null)
            .gte("shopify_order_date", startDate)
            .lte("shopify_order_date", endDate);
          if (storeFilter !== "ALL") q = q.ilike("store_name", storeFilter);
          return q;
        },
        { orderColumn: "shopify_order_date", ascending: true }
      ),
      fetchAllRows<JtDailyRow>(
        () => {
          let q = supabase
            .from("jt_deliveries")
            .select(jtFields)
            .is("shopify_order_id", null)
            .gte("submission_date", jtStartUtc)
            .lte("submission_date", jtEndUtc);
          if (storeFilter !== "ALL") q = q.ilike("store_name", storeFilter);
          return q;
        },
        { orderColumn: "submission_date", ascending: true }
      ),
    ]);

    if (historyRes.error) warnings.push(`J&T history: ${historyRes.error.message}`);
    if (matchedRes.error) warnings.push(`J&T matched: ${matchedRes.error.message}`);
    if (unmatchedRes.error) warnings.push(`J&T unmatched: ${unmatchedRes.error.message}`);

    // (a) per-store statistics and the hazard curve
    if (historyRes.data.length > 0) {
      hazard = buildReturnHazardCurve(historyRes.data, nowMs);

      const perStore = new Map<
        string,
        {
          parcels: number;
          totalShip: number;
          delivered: number;
          returned: number;
          totalReturnCod: number;
          history: { submission_date: string | null; state: "delivered" | "returned" | "open" }[];
        }
      >();
      for (const row of historyRes.data) {
        const store = (row.store_name || "UNKNOWN").toUpperCase();
        if (!perStore.has(store)) {
          perStore.set(store, {
            parcels: 0, totalShip: 0, delivered: 0, returned: 0, totalReturnCod: 0, history: [],
          });
        }
        const st = perStore.get(store)!;
        const state = resolveParcelState(row, observationTimeMs(row.updated_at, nowMs));
        if (row.updated_at && (!jtDataAsOf || row.updated_at > jtDataAsOf)) {
          jtDataAsOf = row.updated_at;
        }
        st.parcels++;
        st.totalShip += parseFloat(String(row.shipping_cost ?? 0)) || 0;
        if (state === "delivered") {
          st.delivered++;
        } else if (state === "returned") {
          st.returned++;
          st.totalReturnCod += parseFloat(String(row.cod_amount ?? 0)) || 0;
        }
        st.history.push({ submission_date: row.submission_date, state });
      }
      for (const [store, st] of perStore) {
        if (st.parcels > 0) storeAvgShipping.set(store, st.totalShip / st.parcels);
        storeStats.set(store, {
          parcels: st.parcels,
          delivered: st.delivered,
          returned: st.returned,
          totalReturnCod: st.totalReturnCod,
          rate: calculateTrailingRtsRate(st.history, nowMs),
        });
      }
    }

    // (b) the requested dates' parcels, settled one by one
    const jtData = [...matchedRes.data, ...unmatchedRes.data];
    const openByStore = new Map<string, { count: number; expected: number }>();

    for (const row of jtData) {
      // Pick the date this parcel should be attributed to.
      let dateStr: string | null = null;
      if (row.shopify_order_date) {
        // Already a YYYY-MM-DD PHT calendar date.
        dateStr = String(row.shopify_order_date);
      } else if (row.submission_date) {
        const d = new Date(row.submission_date);
        if (!isNaN(d.getTime())) dateStr = toPhtDateStr(row.submission_date);
      }
      if (!dateStr) continue;

      const store = (row.store_name || "UNKNOWN").toUpperCase();
      const key = `${dateStr}::${store}`;

      // Every parcel costs its own zone-based J&T fee — delivered, returned or
      // still moving. J&T bills one way only (delivered parcels average
      // PHP 101.61, returned PHP 102.36: the same outbound leg, no return
      // charge), so the fee lives here and only here.
      shippingByDateStore.set(
        key,
        (shippingByDateStore.get(key) || 0) +
          (parseFloat(String(row.shipping_cost ?? 0)) || 0)
      );
      parcelCountByDateStore.set(key, (parcelCountByDateStore.get(key) || 0) + 1);

      // A return costs the COD the customer never paid. cod_amount is the
      // actual selling price; item_value (declared/insured) is the fallback.
      const codAmount = parseFloat(String(row.cod_amount ?? 0)) || 0;
      const itemValue = parseFloat(String(row.item_value ?? 0)) || 0;
      const lostRevenue = codAmount > 0 ? codAmount : itemValue;

      const observedMs = observationTimeMs(row.updated_at, nowMs);
      const state = resolveParcelState(row, observedMs);
      if (state === "returned") {
        returnsByDateStore.set(key, (returnsByDateStore.get(key) || 0) + lostRevenue);
        returnsActualByDateStore.set(key, (returnsActualByDateStore.get(key) || 0) + lostRevenue);
      } else if (state === "open") {
        const p = returnProbabilityForOpenParcel(
          hazard,
          regionForProvince(row.province),
          parcelAgeDays(row.submission_date, observedMs),
          isOutForDelivery(row.order_status)
        );
        const expected = lostRevenue * p;
        if (expected > 0) {
          returnsByDateStore.set(key, (returnsByDateStore.get(key) || 0) + expected);
          returnsInTransitByDateStore.set(key, (returnsInTransitByDateStore.get(key) || 0) + expected);
          returnsProjectedDates.add(dateStr);
        }
        inTransitByDate.set(dateStr, (inTransitByDate.get(dateStr) || 0) + 1);
        const o = openByStore.get(store) || { count: 0, expected: 0 };
        o.count++;
        o.expected += expected;
        openByStore.set(store, o);
      }
    }

    for (const [store, o] of openByStore) {
      if (o.expected < 1) continue;
      warnings.push(
        `${store}: +₱${Math.round(o.expected).toLocaleString()} expected returns from ${o.count} parcel${o.count === 1 ? "" : "s"} still in transit`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`J&T: ${message}`);
  }

  // --- 5b. Returns for orders that have no parcel yet -----------------------
  //
  // Parcels on file are settled above. What's left on a young date is the
  // Shopify orders pick-pack hasn't shipped: invisible to J&T, but the
  // store's share of them will come back. Charge that share at the average
  // COD of a return, using the store's trailing RTS rate. Stores with < 200
  // settled parcels still use the 25% worst-case rule at the store level —
  // their rate isn't trustworthy yet.
  try {
    const allStoresInData = new Set<string>();
    for (const key of revenueByDateStore.keys()) {
      allStoresInData.add(key.split("::")[1]);
    }

    for (const store of allStoresInData) {
      const stats = storeStats.get(store);
      const delivered = stats?.delivered || 0;
      const returned = stats?.returned || 0;
      const settled = delivered + returned;

      // Strategy A — small store: keep 25% worst-case at store level.
      // Distributed by revenue because we have no reliable rate yet.
      if (settled < RTS_MIN_DELIVERED) {
        let actualReturns = 0;
        let storeRevenue = 0;
        for (const [key, value] of returnsByDateStore) {
          if (key.endsWith(`::${store}`)) actualReturns += value;
        }
        for (const [key, value] of revenueByDateStore) {
          if (key.endsWith(`::${store}`)) storeRevenue += value;
        }
        if (storeRevenue <= 0) continue;

        const worstCase = storeRevenue * RTS_WORST_CASE_RATE;
        if (worstCase > actualReturns) {
          const additional = worstCase - actualReturns;
          for (const [key, dateRevenue] of revenueByDateStore) {
            if (!key.endsWith(`::${store}`)) continue;
            const proportion = dateRevenue / storeRevenue;
            returnsByDateStore.set(
              key,
              (returnsByDateStore.get(key) || 0) + additional * proportion
            );
            returnsUnshippedByDateStore.set(
              key,
              (returnsUnshippedByDateStore.get(key) || 0) + additional * proportion
            );
            returnsProjectedDates.add(key.split("::")[0]);
          }
          warnings.push(
            `${store}: Using 25% worst-case RTS (${settled}/${RTS_MIN_DELIVERED} settled)`
          );
        }
        continue;
      }

      // Strategy B — established store: unshipped orders × trailing rate × avg COD.
      const rtsRate = stats!.rate.rate;
      const avgReturnCod = returned > 0 ? stats!.totalReturnCod / returned : 0;
      if (rtsRate <= 0 || avgReturnCod <= 0) continue;

      let storeProjected = 0;
      let storeMissing = 0;
      for (const [key, orderCount] of orderCountByDateStore) {
        if (!key.endsWith(`::${store}`)) continue;
        const date = key.split("::")[0];
        const { projectedReturns, missingParcels } = calculateUnshippedOrderReturns(
          orderCount,
          parcelCountByDateStore.get(key) || 0,
          rtsRate,
          avgReturnCod,
          ageDaysForDate(date)
        );
        if (projectedReturns > 0) {
          returnsByDateStore.set(key, (returnsByDateStore.get(key) || 0) + projectedReturns);
          returnsUnshippedByDateStore.set(key, (returnsUnshippedByDateStore.get(key) || 0) + projectedReturns);
          returnsProjectedDates.add(date);
          storeProjected += projectedReturns;
          storeMissing += missingParcels;
        }
      }

      if (storeProjected > 0) {
        const rtsPct = Math.round(rtsRate * 1000) / 10;
        const basis = stats!.rate.windowed
          ? `trailing ${RTS_RATE_WINDOW_DAYS}d`
          : `all-time, ${stats!.rate.settled} settled`;
        warnings.push(
          `${store}: +₱${Math.round(storeProjected).toLocaleString()} expected returns for ~${Math.round(storeMissing)} orders not yet shipped (last ${SETTLEMENT_WINDOW_DAYS} days, ${rtsPct}% RTS rate, ${basis})`
        );
      }
    }
  } catch {
    // Non-critical — continue with what the parcels on file say
  }

  // --- 5c. Shipping: real per-parcel J&T fee, projected for unshipped orders --
  //
  // Every parcel carries its own zone-based fee, so no flat rate is needed.
  // But pick-pack lags the order and J&T files are uploaded in batches, so the
  // newest ~3 days only have parcels for about 60% of their orders. Charging
  // only what's on file would report almost no shipping cost on those days and
  // inflate profit — the same trap the void and RTS projections exist to avoid.
  for (const key of Array.from(revenueByDateStore.keys())) {
    const [dateStr, storeName] = key.split("::");
    const orderCount = orderCountByDateStore.get(key) || 0;
    if (orderCount <= 0) continue;

    const { shipping, isProjected } = calculateShippingWithProjection(
      shippingByDateStore.get(key) || 0,
      parcelCountByDateStore.get(key) || 0,
      orderCount,
      storeAvgShipping.get(storeName) || 0
    );
    shippingByDateStore.set(key, shipping);
    if (isProjected) shippingProjectedDates.add(dateStr);
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
      returns_actual: number;
      returns_in_transit_est: number;
      returns_unshipped_est: number;
      parcel_count: number;
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
        returns_actual: 0,
        returns_in_transit_est: 0,
        returns_unshipped_est: 0,
        parcel_count: 0,
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
  const breakdowns: [Map<string, number>, "returns_actual" | "returns_in_transit_est" | "returns_unshipped_est" | "parcel_count"][] = [
    [returnsActualByDateStore, "returns_actual"],
    [returnsInTransitByDateStore, "returns_in_transit_est"],
    [returnsUnshippedByDateStore, "returns_unshipped_est"],
    [parcelCountByDateStore, "parcel_count"],
  ];
  for (const [map, field] of breakdowns) {
    for (const [key, value] of map) {
      const row = dailyMap.get(key.split("::")[0]);
      if (row) row[field] += value;
    }
  }

  // Build final daily array
  const daily: DailyPnlRow[] = [];
  for (const [date, row] of dailyMap) {
    // Only flagged when some of the day's orders still had no parcel on file.
    const shippingProjected = shippingProjectedDates.has(date);
    const returnsProjected = returnsProjectedDates.has(date);
    const netProfit = calculateNetProfit(
      row.revenue, row.cogs, row.ad_spend, row.shipping, row.returns_value
    );
    const marginPct = calculateMarginPct(netProfit, row.revenue);

    daily.push({
      date,
      revenue: roundCurrency(row.revenue),
      // Stays fractional. This is the expected number of orders that survive
      // confirmation, and it's the divisor behind both AOV and CPP — rounding
      // it here made the summary card divide by 4 while this row divided by
      // 3.5, so one day reported two different AOVs. Rounded at render only.
      order_count: row.order_count,
      cogs: roundCurrency(row.cogs),
      ad_spend: roundCurrency(row.ad_spend),
      shipping: roundCurrency(row.shipping),
      returns_value: roundCurrency(row.returns_value),
      net_profit: roundCurrency(netProfit),
      margin_pct: marginPct,
      aov: roundCurrency(calculateAov(row.revenue, row.order_count)),
      cpp: roundCurrency(calculateCpp(row.ad_spend, row.order_count)),
      shipping_projected: shippingProjected,
      returns_projected: returnsProjected,
      void_adjusted: voidAdjustedDates.has(date),
      in_transit_count: inTransitByDate.get(date) || 0,
      returns_actual: roundCurrency(row.returns_actual),
      returns_in_transit_est: roundCurrency(row.returns_in_transit_est),
      returns_unshipped_est: roundCurrency(row.returns_unshipped_est),
      parcel_count: row.parcel_count,
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
    aov: 0,
    cpp: 0,
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
  summary.aov = roundCurrency(calculateAov(summary.revenue, summary.order_count));
  summary.cpp = roundCurrency(calculateCpp(summary.ad_spend, summary.order_count));

  const responseData = {
    summary,
    daily,
    stores: Array.from(allStoreNames).sort(),
    missing_cogs_skus: Array.from(missingCogsSkus).sort(),
    ad_spend_vat_rate: AD_SPEND_VAT_RATE,
    // Newest J&T row write: how fresh the parcel statuses are. Every open
    // parcel is judged at the age it had in its last upload, so this is the
    // date the "in transit" estimates are really about.
    jt_data_as_of: jtDataAsOf,
    warnings,
  };

  // Write to Supabase cache (non-blocking)
  const refreshedAt = new Date().toISOString();
  setCachedResponse(supabase, "pnl", cacheKey, responseData).catch(() => {});

  return Response.json({ ...responseData, refreshed_at: refreshedAt });
}
