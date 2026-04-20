import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { UnfulfilledOrder, OrderLineItem } from "@/lib/fulfillment/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// In-memory cache — 30 seconds for unfulfilled orders (change frequently)
const cache = new Map<string, { data: unknown; timestamp: number }>();
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

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check cache
  const cacheKey = "fulfillment-needs-packing";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json(cached.data);
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
          : "No active Shopify stores configured.",
      },
      { status: 400 }
    );
  }

  const now = new Date();
  const allOrders: UnfulfilledOrder[] = [];
  const storeNames: string[] = [];

  // Fetch from all stores in parallel
  await Promise.all(
    storesData.map(async (store) => {
      try {
        storeNames.push(store.name);
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

          allOrders.push({
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

  // Exclude orders already verified (in pack_verifications table)
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

  const responseData = { orders: needsPacking, stores: storeNames };
  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json(responseData);
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

    // Invalidate cache after fulfilling
    cache.delete("fulfillment-unfulfilled");

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
