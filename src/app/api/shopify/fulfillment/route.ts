import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { UnfulfilledOrder, OrderLineItem } from "@/lib/fulfillment/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// In-memory cache — 30 seconds for the SLOW Shopify fetch only (the per-store
// orders.json calls take 1-3s and are subject to Shopify rate limits, so we
// don't want to hit them on every refresh).
//
// We deliberately do NOT cache the final filtered "needs packing" list:
// pack_verifications is the source of truth for "what's been packed", and
// must be re-queried on every GET so writes from manual-clear and scan-verify
// are reflected immediately. Caching the filtered result was the bug — orders
// that had just been cleared kept reappearing because the old cache held the
// pre-clear filter result for up to 30 seconds across all warm instances.
const SHOPIFY_ORDERS_CACHE_KEY = "fulfillment-shopify-orders";
const cache = new Map<
  string,
  {
    data: { allOrders: UnfulfilledOrder[]; storeNames: string[] };
    timestamp: number;
  }
>();
const CACHE_TTL = 30 * 1000;

interface RawShopifyLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  sku: string | null;
  barcode?: string | null;
  quantity: number;
  price: string;
  variant_id: number;
  product_id: number;
  fulfillment_status: string | null;
}

interface RawUnfulfilledOrder {
  id: number;
  name: string;
  created_at: string;
  customer: {
    first_name: string;
    last_name: string;
  } | null;
  line_items: RawShopifyLineItem[];
  fulfillment_status: string | null;
  fulfillments?: Array<{
    tracking_number: string | null;
    tracking_numbers: string[];
  }>;
}

async function fetchFulfilledOrders(
  storeUrl: string,
  apiToken: string
): Promise<RawUnfulfilledOrder[]> {
  const allOrders: RawUnfulfilledOrder[] = [];
  // Fetch fulfilled orders from last 7 days (recently printed waybills)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      fulfillment_status: "shipped",
      status: "any",
      created_at_min: sevenDaysAgo,
      limit: "250",
      fields:
        "id,name,created_at,customer,line_items,fulfillment_status,fulfillments",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Shopify API error (${res.status}): ${text.slice(0, 200)}`
      );
    }
    const json = await res.json();
    allOrders.push(...(json.orders || []));

    // Handle pagination via Link header
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return allOrders;
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";

  const supabase = await createClient();

  // Try to serve the slow Shopify fetch from cache. If forceRefresh, skip it
  // and re-pull from Shopify. The verifiedIds filter below ALWAYS runs fresh
  // regardless of cache hit/miss, so manual-clear and scan-verify writes show
  // up on the very next GET.
  let allOrders: UnfulfilledOrder[];
  let storeNames: string[];

  const cached = cache.get(SHOPIFY_ORDERS_CACHE_KEY);
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL
  ) {
    allOrders = cached.data.allOrders;
    storeNames = cached.data.storeNames;
  } else {
    const { data: storesData, error: storesError } = await supabase
      .from("shopify_stores")
      .select("id, name, store_url, api_token")
      .eq("is_active", true);

    if (storesError || !storesData || storesData.length === 0) {
      return Response.json(
        {
          error: storesError
            ? "Failed to load stores"
            : "No active Shopify stores configured.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const fetchedOrders: UnfulfilledOrder[] = [];
    const fetchedNames: string[] = [];

    await Promise.all(
    storesData.map(async (store) => {
      try {
        fetchedNames.push(store.name);
        const rawOrders = await fetchFulfilledOrders(
          store.store_url,
          store.api_token
        );

        for (const raw of rawOrders) {
          const lineItems: OrderLineItem[] = (raw.line_items || []).map(
            (li) => ({
              id: li.id,
              title: li.title,
              variant_title: li.variant_title || null,
              sku: li.sku || null,
              barcode: li.barcode || null,
              quantity: li.quantity,
              price: li.price,
              variant_id: li.variant_id,
              product_id: li.product_id,
              fulfillment_status: li.fulfillment_status || null,
            })
          );

          const itemCount = lineItems.reduce(
            (sum, li) => sum + li.quantity,
            0
          );
          const ageDays = Math.floor(
            (now.getTime() - new Date(raw.created_at).getTime()) /
              (1000 * 60 * 60 * 24)
          );

          const customerName = raw.customer
            ? `${raw.customer.first_name || ""} ${raw.customer.last_name || ""}`.trim()
            : "Unknown";

          // Collect tracking numbers from fulfillments (waybill numbers)
          const trackingNumbers: string[] = [];
          for (const f of raw.fulfillments || []) {
            if (f.tracking_number) trackingNumbers.push(f.tracking_number);
            for (const tn of f.tracking_numbers || []) {
              if (tn && !trackingNumbers.includes(tn)) trackingNumbers.push(tn);
            }
          }

          fetchedOrders.push({
            id: raw.id,
            name: raw.name,
            store_name: store.name,
            store_id: store.id,
            created_at: raw.created_at,
            customer_name: customerName,
            line_items: lineItems,
            item_count: itemCount,
            age_days: ageDays,
            tracking_numbers: trackingNumbers,
          });
        }
      } catch (err) {
        console.error(
          `[Fulfillment] Failed to fetch orders for "${store.name}":`,
          err instanceof Error ? err.message : err
        );
      }
    })
    );

    cache.set(SHOPIFY_ORDERS_CACHE_KEY, {
      data: { allOrders: fetchedOrders, storeNames: fetchedNames },
      timestamp: Date.now(),
    });
    allOrders = fetchedOrders;
    storeNames = fetchedNames;
  }

  // ALWAYS query pack_verifications fresh — it's the source of truth for
  // "what's been packed". Cheap (~10ms) and ensures manual-clear / scan-verify
  // writes show up on the very next GET regardless of which Vercel instance
  // serves the request or whether the Shopify cache is warm.
  const { data: verifiedOrders } = await supabase
    .from("pack_verifications")
    .select("order_id");

  const verifiedIds = new Set((verifiedOrders || []).map((v) => v.order_id));
  const needsPacking = allOrders.filter((o) => !verifiedIds.has(String(o.id)));

  // Sort by created_at descending (newest first — most recent waybills on top)
  needsPacking.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return Response.json({ orders: needsPacking, stores: storeNames });
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, order_id, line_items } = body as {
    store_name: string;
    order_id: number;
    line_items?: Array<{ id: number }>;
  };

  if (!store_name || !order_id) {
    return Response.json(
      { error: "store_name and order_id are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: store, error: storeError } = await supabase
    .from("shopify_stores")
    .select("store_url, api_token")
    .eq("name", store_name)
    .eq("is_active", true)
    .single();

  if (storeError || !store) {
    return Response.json(
      { error: `Store "${store_name}" not found` },
      { status: 404 }
    );
  }

  try {
    // Step 1: Get fulfillment orders for this order
    const foRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders/${order_id}/fulfillment_orders.json`,
      {
        headers: { "X-Shopify-Access-Token": store.api_token },
        cache: "no-store",
      }
    );
    if (!foRes.ok) {
      const text = await foRes.text();
      throw new Error(
        `Failed to get fulfillment orders (${foRes.status}): ${text.slice(0, 200)}`
      );
    }
    const foJson = await foRes.json();
    const fulfillmentOrders = foJson.fulfillment_orders || [];

    if (fulfillmentOrders.length === 0) {
      return Response.json(
        { error: "No fulfillment orders found for this order" },
        { status: 400 }
      );
    }

    // Build line_items_by_fulfillment_order payload
    const lineItemsByFO = fulfillmentOrders
      .filter(
        (fo: { status: string }) =>
          fo.status === "open" || fo.status === "in_progress"
      )
      .map(
        (fo: {
          id: number;
          line_items: Array<{ id: number; quantity: number }>;
        }) => {
          const foLineItems = line_items
            ? fo.line_items
                .filter((foli) =>
                  line_items.some((li) => li.id === foli.id)
                )
                .map((foli) => ({
                  id: foli.id,
                  quantity: foli.quantity,
                }))
            : fo.line_items.map((foli) => ({
                id: foli.id,
                quantity: foli.quantity,
              }));

          return {
            fulfillment_order_id: fo.id,
            fulfillment_order_line_items: foLineItems,
          };
        }
      )
      .filter(
        (entry: { fulfillment_order_line_items: unknown[] }) =>
          entry.fulfillment_order_line_items.length > 0
      );

    if (lineItemsByFO.length === 0) {
      return Response.json(
        { error: "No open fulfillment order line items to fulfill" },
        { status: 400 }
      );
    }

    // Step 2: Create fulfillment
    const fulfillRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": store.api_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fulfillment: {
            line_items_by_fulfillment_order: lineItemsByFO,
          },
        }),
        cache: "no-store",
      }
    );

    if (!fulfillRes.ok) {
      const text = await fulfillRes.text();
      throw new Error(
        `Fulfillment creation failed (${fulfillRes.status}): ${text.slice(0, 300)}`
      );
    }

    const fulfillJson = await fulfillRes.json();

    // Invalidate the Shopify-orders cache — this endpoint actually flips the
    // order to "shipped" in Shopify, so the next GET should re-pull from
    // Shopify rather than serve a 30-second-old snapshot. (The verifiedIds
    // filter is fresh on every GET regardless, so this only affects the
    // raw-orders-from-Shopify portion.)
    cache.delete(SHOPIFY_ORDERS_CACHE_KEY);

    return Response.json({
      success: true,
      fulfillment_id: fulfillJson.fulfillment?.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Fulfillment POST]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
