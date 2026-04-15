import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { PickListItem } from "@/lib/fulfillment/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

interface RawLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  sku: string | null;
  barcode?: string | null;
  quantity: number;
  variant_id: number;
  product_id: number;
}

interface RawOrder {
  id: number;
  name: string;
  line_items: RawLineItem[];
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
  const ordersParam = searchParams.get("orders");
  const storeName = searchParams.get("store");

  if (!ordersParam || !storeName) {
    return Response.json(
      { error: "orders and store query params are required" },
      { status: 400 }
    );
  }

  const orderIds = ordersParam.split(",").map((id) => id.trim()).filter(Boolean);
  if (orderIds.length === 0) {
    return Response.json(
      { error: "No order IDs provided" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Get store credentials
  const { data: store, error: storeError } = await supabase
    .from("shopify_stores")
    .select("id, store_url, api_token")
    .eq("name", storeName)
    .eq("is_active", true)
    .single();

  if (storeError || !store) {
    return Response.json(
      { error: `Store "${storeName}" not found` },
      { status: 404 }
    );
  }

  // Fetch each order's full details in parallel
  const orderResults = await Promise.allSettled(
    orderIds.map(async (orderId) => {
      const res = await fetch(
        `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json?fields=id,name,line_items`,
        {
          headers: { "X-Shopify-Access-Token": store.api_token },
          cache: "no-store",
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Order ${orderId} fetch failed (${res.status}): ${text.slice(0, 200)}`
        );
      }
      const json = await res.json();
      return json.order as RawOrder;
    })
  );

  // Collect all line items, keyed by SKU
  const skuMap = new Map<
    string,
    {
      sku: string;
      barcode: string | null;
      product_title: string;
      variant_title: string | null;
      total_qty: number;
      orders: Array<{ order_name: string; qty: number }>;
    }
  >();

  let orderCount = 0;

  for (const result of orderResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const order = result.value;
    orderCount++;

    for (const li of order.line_items) {
      const sku = li.sku || `NO-SKU-${li.variant_id || li.id}`;
      const existing = skuMap.get(sku);

      if (existing) {
        existing.total_qty += li.quantity;
        existing.orders.push({ order_name: order.name, qty: li.quantity });
      } else {
        skuMap.set(sku, {
          sku,
          barcode: li.barcode || null,
          product_title: li.title,
          variant_title: li.variant_title || null,
          total_qty: li.quantity,
          orders: [{ order_name: order.name, qty: li.quantity }],
        });
      }
    }
  }

  // Fetch bin locations from Supabase
  const skus = Array.from(skuMap.keys());
  const { data: binData } = await supabase
    .from("bin_locations")
    .select("sku, bin_code, zone")
    .eq("store_id", store.id)
    .in("sku", skus);

  const binMap = new Map<string, { bin_code: string; zone: string | null }>();
  if (binData) {
    for (const bin of binData) {
      binMap.set(bin.sku, { bin_code: bin.bin_code, zone: bin.zone });
    }
  }

  // Build pick list items
  const items: PickListItem[] = Array.from(skuMap.values()).map((entry) => {
    const bin = binMap.get(entry.sku);
    return {
      sku: entry.sku,
      barcode: entry.barcode,
      product_title: entry.product_title,
      variant_title: entry.variant_title,
      total_qty: entry.total_qty,
      picked_qty: 0,
      bin_code: bin?.bin_code || null,
      zone: bin?.zone || null,
      orders: entry.orders,
    };
  });

  // Sort by zone then bin_code
  items.sort((a, b) => {
    const zoneA = a.zone || "zzz";
    const zoneB = b.zone || "zzz";
    if (zoneA !== zoneB) return zoneA.localeCompare(zoneB);
    const binA = a.bin_code || "zzz";
    const binB = b.bin_code || "zzz";
    return binA.localeCompare(binB);
  });

  const totalItems = items.reduce((sum, item) => sum + item.total_qty, 0);

  return Response.json({
    items,
    order_count: orderCount,
    total_items: totalItems,
  });
}
