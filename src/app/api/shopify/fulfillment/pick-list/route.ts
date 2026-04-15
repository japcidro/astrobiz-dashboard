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
  const storeName = searchParams.get("store") || "ALL";

  if (!ordersParam) {
    return Response.json({ error: "orders query param is required" }, { status: 400 });
  }

  const orderIds = ordersParam.split(",").map((id) => id.trim()).filter(Boolean);
  if (orderIds.length === 0) {
    return Response.json({ error: "No order IDs provided" }, { status: 400 });
  }

  const supabase = await createClient();

  // Get all active stores (or specific one)
  let storesQuery = supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storeName !== "ALL") {
    storesQuery = storesQuery.eq("name", storeName);
  }

  const { data: stores, error: storesError } = await storesQuery;

  if (storesError || !stores || stores.length === 0) {
    return Response.json(
      { error: `No active stores found${storeName !== "ALL" ? ` for "${storeName}"` : ""}` },
      { status: 400 }
    );
  }

  // Fetch orders from each store in parallel, trying each store for each order
  const allOrders: Array<RawOrder & { store_name: string }> = [];

  await Promise.all(
    stores.map(async (store) => {
      for (const orderId of orderIds) {
        try {
          const res = await fetch(
            `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json?fields=id,name,line_items`,
            { headers: { "X-Shopify-Access-Token": store.api_token }, cache: "no-store" }
          );
          if (res.ok) {
            const json = await res.json();
            if (json.order) {
              // Check if we already have this order from another store
              if (!allOrders.find((o) => o.id === json.order.id)) {
                allOrders.push({ ...json.order, store_name: store.name });
              }
            }
          }
        } catch {
          // Order not found in this store — try next
        }
      }
    })
  );

  if (allOrders.length === 0) {
    return Response.json({ items: [], order_count: 0, total_items: 0 });
  }

  // Fetch bin locations
  const { data: binData } = await supabase.from("bin_locations").select("sku, bin_code, zone");
  const binMap = new Map<string, { bin_code: string; zone: string | null }>();
  for (const b of binData || []) {
    binMap.set((b.sku || "").toLowerCase(), { bin_code: b.bin_code, zone: b.zone });
  }

  // Consolidate by SKU
  const skuMap = new Map<string, PickListItem>();

  for (const order of allOrders) {
    for (const li of order.line_items) {
      const sku = li.sku || `NO-SKU-${li.id}`;
      const key = sku.toLowerCase();

      if (!skuMap.has(key)) {
        const bin = binMap.get(key);
        skuMap.set(key, {
          sku,
          barcode: li.barcode || null,
          product_title: li.title,
          variant_title: li.variant_title,
          total_qty: 0,
          picked_qty: 0,
          bin_code: bin?.bin_code || null,
          zone: bin?.zone || null,
          orders: [],
        });
      }

      const item = skuMap.get(key)!;
      item.total_qty += li.quantity;
      item.orders.push({ order_name: order.name, qty: li.quantity });
    }
  }

  // Sort by zone then bin_code
  const items = Array.from(skuMap.values()).sort((a, b) => {
    const za = a.zone || "ZZZ";
    const zb = b.zone || "ZZZ";
    if (za !== zb) return za.localeCompare(zb);
    const ba = a.bin_code || "ZZZ";
    const bb = b.bin_code || "ZZZ";
    return ba.localeCompare(bb);
  });

  const totalItems = items.reduce((s, i) => s + i.total_qty, 0);

  return Response.json({
    items,
    order_count: allOrders.length,
    total_items: totalItems,
  });
}
