import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { shopifyFetchOrders, toShopifyOrder } from "@/lib/shopify/fetch-orders";
import {
  buildRepeatBuyers,
  type CountMode,
  type OrderParcel,
  type OrderWithParcels,
} from "@/lib/shopify/repeat-buyers";

export const dynamic = "force-dynamic";
// A 365-day window is thousands of Shopify orders across every store plus the
// matching parcel rows — well past the default budget.
export const maxDuration = 300;

const ALLOWED_WINDOWS = [30, 90, 180, 365];
const DEFAULT_WINDOW = 180;
const ALLOWED_MIN_ORDERS = [2, 3, 5];
// Every buyer carries their full order + line-item history so the drawer needs
// no second round trip. That makes the payload grow with the window, so only
// the top spenders travel — the summary is still computed over all of them.
const MAX_BUYERS = 500;
// Pick-pack lag: an order placed on day X reaches J&T on X+1..X+3. Reach back
// past the window start so the first days' orders still find their parcels.
const PARCEL_LAG_BUFFER_DAYS = 7;
// Matches the admin upload panel and the Bonus Tracker badge.
const STALE_AFTER_DAYS = 3;

// In-memory cache — survives across requests while the server instance lives.
// Longer TTL than /api/shopify/orders: this window is measured in months, so a
// fresh order barely moves it, and the fetch is far more expensive.
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

interface JtRow {
  waybill: string | null;
  classification: string | null;
  is_delivered: boolean | null;
  is_returned: boolean | null;
  signing_time: string | null;
  rts_reason: string | null;
  cod_amount: number | string | null;
}

export interface ParcelDataFreshness {
  last_upload_at: string | null;
  latest_parcel_date: string | null;
  days_behind: number | null;
  is_stale: boolean;
}

function phtDateString(d: Date): string {
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, "0")}-${String(pht.getUTCDate()).padStart(2, "0")}`;
}

/**
 * PHT-anchored window: from 00:00 PHT `windowDays` ago through now.
 * Matches the day boundaries every other Astrobiz screen reports on.
 */
function computeWindow(windowDays: number): {
  createdAtMin: string;
  createdAtMax: string;
  parcelFloor: string;
} {
  const nowUtc = new Date();
  const start = new Date(nowUtc.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const startDay = phtDateString(start);
  const parcelStart = new Date(
    start.getTime() - PARCEL_LAG_BUFFER_DAYS * 24 * 60 * 60 * 1000
  );
  return {
    createdAtMin: `${startDay}T00:00:00+08:00`,
    createdAtMax: nowUtc.toISOString(),
    parcelFloor: `${phtDateString(parcelStart)}T00:00:00+08:00`,
  };
}

/**
 * Every parcel submitted since `parcelFloor`, keyed by waybill.
 *
 * Read as one indexed range scan rather than chunked `waybill IN (...)`
 * lookups: the row count is roughly the order count either way, and the range
 * scan is a single paginated drain instead of dozens of round trips.
 */
async function fetchParcelsByWaybill(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parcelFloor: string
): Promise<{ map: Map<string, OrderParcel[]>; error: string | null }> {
  const { data, error } = await fetchAllRows<JtRow>(
    () =>
      supabase
        .from("jt_deliveries")
        .select(
          "waybill, classification, is_delivered, is_returned, signing_time, rts_reason, cod_amount"
        )
        .gte("submission_date", parcelFloor),
    { orderColumn: "waybill" }
  );

  const map = new Map<string, OrderParcel[]>();
  for (const row of data) {
    const waybill = (row.waybill || "").trim().toUpperCase();
    if (!waybill) continue;
    const parcel: OrderParcel = {
      waybill,
      classification: row.classification || "Pending",
      is_delivered: Boolean(row.is_delivered),
      is_returned: Boolean(row.is_returned),
      signing_time: row.signing_time,
      rts_reason: row.rts_reason,
      cod_amount: Number(row.cod_amount ?? 0),
    };
    const existing = map.get(waybill);
    if (existing) existing.push(parcel);
    else map.set(waybill, [parcel]);
  }

  return { map, error: error ? error.message : null };
}

/**
 * How current the J&T data is. Without this, a week-old upload reads as
 * "nobody is buying again" instead of "the parcels aren't in yet".
 */
async function fetchFreshness(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ParcelDataFreshness> {
  const [batch, newest] = await Promise.all([
    supabase
      .from("jt_upload_batches")
      .select("uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jt_deliveries")
      .select("submission_date")
      .not("submission_date", "is", null)
      .order("submission_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latestParcelDate = newest.data?.submission_date
    ? phtDateString(new Date(newest.data.submission_date))
    : null;

  const today = phtDateString(new Date());
  const daysBehind =
    latestParcelDate === null
      ? null
      : Math.max(
          0,
          Math.round(
            (new Date(`${today}T00:00:00Z`).getTime() -
              new Date(`${latestParcelDate}T00:00:00Z`).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        );

  return {
    last_upload_at: batch.data?.uploaded_at ?? null,
    latest_parcel_date: latestParcelDate,
    days_behind: daysBehind,
    is_stale: daysBehind !== null && daysBehind > STALE_AFTER_DAYS,
  };
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Customer-level spend and contact details are CEO data, not floor data.
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedWindow = parseInt(searchParams.get("window") || "", 10);
  const windowDays = ALLOWED_WINDOWS.includes(requestedWindow)
    ? requestedWindow
    : DEFAULT_WINDOW;
  const requestedMin = parseInt(searchParams.get("min_orders") || "", 10);
  const minOrders = ALLOWED_MIN_ORDERS.includes(requestedMin) ? requestedMin : 2;
  const storeFilter = searchParams.get("store") || "ALL";
  const countMode: CountMode =
    searchParams.get("count_mode") === "all" ? "all" : "delivered";
  const forceRefresh = searchParams.get("refresh") === "1";

  const cacheKey = `repeat-buyers-${windowDays}-${minOrders}-${storeFilter}-${countMode}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json({
      ...(cached.data as Record<string, unknown>),
      cached: true,
    });
  }

  const supabase = await createClient();
  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData || storesData.length === 0) {
    return Response.json(
      {
        error: storesError
          ? "Failed to load stores"
          : "No active Shopify stores configured. Go to Settings.",
      },
      { status: 400 }
    );
  }

  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.id === storeFilter);

  const stores = storesData.map((s) => ({ id: s.id, name: s.name }));
  const { createdAtMin, createdAtMax, parcelFloor } = computeWindow(windowDays);

  if (targetStores.length === 0) {
    return Response.json({
      buyers: [],
      summary: buildRepeatBuyers([], { minOrders, windowDays, countMode })
        .summary,
      stores,
      warnings: [],
      window_days: windowDays,
      count_mode: countMode,
      freshness: await fetchFreshness(supabase),
      total_matching: 0,
      truncated: false,
    });
  }

  const warnings: string[] = [];
  const shopifyOrders: OrderWithParcels[] = [];
  const now = new Date();

  // Shopify and Supabase are independent — no reason to wait on one another.
  const [, parcels, freshness] = await Promise.all([
    Promise.all(
      targetStores.map(async (store) => {
        try {
          const rawOrders = await shopifyFetchOrders(
            store.store_url,
            store.api_token,
            createdAtMin,
            createdAtMax
          );
          for (const raw of rawOrders) {
            shopifyOrders.push({
              ...toShopifyOrder(raw, { id: store.id, name: store.name }, now),
              parcels: [],
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(
            `[RepeatBuyers] Failed to fetch orders for store "${store.name}":`,
            message
          );
          warnings.push(`${store.name}: ${message}`);
        }
      })
    ),
    fetchParcelsByWaybill(supabase, parcelFloor),
    fetchFreshness(supabase),
  ]);

  if (parcels.error) {
    // Without parcels every order reads as "unverified", which would wrongly
    // empty the delivered view. Say so rather than quietly showing nothing.
    warnings.push(`J&T parcels: ${parcels.error}`);
  }

  for (const order of shopifyOrders) {
    order.parcels = order.tracking_numbers.flatMap(
      (waybill) => parcels.map.get(waybill) ?? []
    );
  }

  const { buyers, summary } = buildRepeatBuyers(shopifyOrders, {
    minOrders,
    windowDays,
    countMode,
    now,
  });

  const responseData = {
    buyers: buyers.slice(0, MAX_BUYERS),
    summary,
    stores,
    warnings,
    window_days: windowDays,
    count_mode: countMode,
    freshness,
    total_matching: buyers.length,
    truncated: buyers.length > MAX_BUYERS,
    refreshed_at: now.toISOString(),
  };

  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json(responseData);
}
