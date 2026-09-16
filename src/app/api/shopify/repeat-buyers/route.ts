import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { shopifyFetchOrders, toShopifyOrder } from "@/lib/shopify/fetch-orders";
import { buildRepeatBuyers } from "@/lib/shopify/repeat-buyers";
import type { ShopifyOrder } from "@/lib/shopify/types";

export const dynamic = "force-dynamic";
// A 365-day window across every store is thousands of orders and dozens of
// paginated Shopify calls — well past the default budget.
export const maxDuration = 300;

const ALLOWED_WINDOWS = [30, 90, 180, 365];
const DEFAULT_WINDOW = 180;
const ALLOWED_MIN_ORDERS = [2, 3, 5];
// Every buyer carries their full order + line-item history so the drawer needs
// no second round trip. That makes the payload grow with the window, so only
// the top spenders travel — the summary is still computed over all of them.
const MAX_BUYERS = 500;

// In-memory cache — survives across requests while the server instance lives.
// Longer TTL than /api/shopify/orders: this window is measured in months, so a
// fresh order barely moves it, and the fetch is far more expensive.
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * PHT-anchored window: from 00:00 PHT `windowDays` ago through now.
 * Matches the day boundaries every other Astrobiz screen reports on.
 */
function computeWindow(windowDays: number): {
  createdAtMin: string;
  createdAtMax: string;
} {
  const nowUtc = new Date();
  const phNow = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const start = new Date(phNow.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, "0");
  const d = String(start.getUTCDate()).padStart(2, "0");
  return {
    createdAtMin: `${y}-${m}-${d}T00:00:00+08:00`,
    createdAtMax: nowUtc.toISOString(),
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
  const forceRefresh = searchParams.get("refresh") === "1";

  const cacheKey = `repeat-buyers-${windowDays}-${minOrders}-${storeFilter}`;
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

  if (targetStores.length === 0) {
    return Response.json({
      buyers: [],
      summary: buildRepeatBuyers([], { minOrders, windowDays }).summary,
      stores,
      warnings: [],
      window_days: windowDays,
      total_matching: 0,
      truncated: false,
    });
  }

  const { createdAtMin, createdAtMax } = computeWindow(windowDays);
  const warnings: string[] = [];
  const allOrders: ShopifyOrder[] = [];
  const now = new Date();

  await Promise.all(
    targetStores.map(async (store) => {
      try {
        const rawOrders = await shopifyFetchOrders(
          store.store_url,
          store.api_token,
          createdAtMin,
          createdAtMax
        );
        for (const raw of rawOrders) {
          allOrders.push(
            toShopifyOrder(raw, { id: store.id, name: store.name }, now)
          );
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
  );

  const { buyers, summary } = buildRepeatBuyers(allOrders, {
    minOrders,
    windowDays,
    now,
  });

  const responseData = {
    buyers: buyers.slice(0, MAX_BUYERS),
    summary,
    stores,
    warnings,
    window_days: windowDays,
    total_matching: buyers.length,
    truncated: buyers.length > MAX_BUYERS,
    refreshed_at: now.toISOString(),
  };

  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json(responseData);
}
