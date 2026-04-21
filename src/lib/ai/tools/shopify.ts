// Shopify tools — direct access to the Shopify REST API using credentials
// stored in the shopify_stores table. We deliberately don't route through
// /api/shopify/orders (which has its own caching + auth + summary logic)
// because the AI's shape needs are different: compact summaries, no
// aging bands, no 5-min cache pollution from tool queries.

import type { SupabaseClient } from "@supabase/supabase-js";

const SHOPIFY_API_VERSION = "2024-01";
const PH_OFFSET = "+08:00";

type OrderDateFilter =
  | "today"
  | "yesterday"
  | "last_7d"
  | "this_month"
  | "last_30d"
  | "custom";

interface StoreCreds {
  name: string;
  store_url: string;
  api_token: string;
}

interface RawShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  tags: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    city: string;
    province: string;
    phone: string | null;
  } | null;
  line_items: Array<{
    title: string;
    variant_title: string | null;
    quantity: number;
    price: string;
    sku: string | null;
  }>;
  fulfillments: Array<{
    tracking_number: string | null;
    tracking_company: string | null;
  }> | null;
  gateway: string;
  note: string | null;
}

function computeDateRange(
  dateFilter: OrderDateFilter,
  dateFrom?: string | null,
  dateTo?: string | null
): { createdAtMin: string; createdAtMax: string } {
  const nowUtc = new Date();
  const phNow = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const y = phNow.getUTCFullYear();
  const m = phNow.getUTCMonth();
  const d = phNow.getUTCDate();
  const startOfDay = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00${PH_OFFSET}`;
  const endOfDay = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}T23:59:59${PH_OFFSET}`;

  switch (dateFilter) {
    case "today":
      return { createdAtMin: startOfDay(y, m, d), createdAtMax: nowUtc.toISOString() };
    case "yesterday": {
      const yd = new Date(phNow.getTime() - 86400_000);
      return {
        createdAtMin: startOfDay(yd.getUTCFullYear(), yd.getUTCMonth(), yd.getUTCDate()),
        createdAtMax: endOfDay(yd.getUTCFullYear(), yd.getUTCMonth(), yd.getUTCDate()),
      };
    }
    case "last_7d": {
      const past = new Date(phNow.getTime() - 7 * 86400_000);
      return {
        createdAtMin: startOfDay(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }
    case "this_month":
      return { createdAtMin: startOfDay(y, m, 1), createdAtMax: nowUtc.toISOString() };
    case "last_30d": {
      const past = new Date(phNow.getTime() - 30 * 86400_000);
      return {
        createdAtMin: startOfDay(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate()),
        createdAtMax: nowUtc.toISOString(),
      };
    }
    case "custom":
      return {
        createdAtMin: dateFrom || nowUtc.toISOString(),
        createdAtMax: dateTo || nowUtc.toISOString(),
      };
  }
}

async function loadStores(
  supabase: SupabaseClient,
  storeName?: string
): Promise<StoreCreds[]> {
  let query = supabase
    .from("shopify_stores")
    .select("name, store_url, api_token")
    .eq("is_active", true);
  if (storeName) query = query.eq("name", storeName);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreCreds[];
}

async function shopifyFetchOrders(
  store: StoreCreds,
  createdAtMin: string,
  createdAtMax: string,
  financialStatus?: string,
  fulfillmentStatus?: string,
  limit = 250
): Promise<RawShopifyOrder[]> {
  const params: Record<string, string> = {
    status: "any",
    created_at_min: createdAtMin,
    created_at_max: createdAtMax,
    limit: String(Math.min(limit, 250)),
    fields:
      "id,name,created_at,total_price,currency,financial_status,fulfillment_status,cancelled_at,tags,customer,shipping_address,line_items,fulfillments,gateway,note",
  };
  if (financialStatus && financialStatus !== "any")
    params.financial_status = financialStatus;
  if (fulfillmentStatus && fulfillmentStatus !== "any")
    params.fulfillment_status = fulfillmentStatus;

  const all: RawShopifyOrder[] = [];
  let url: string = `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${new URLSearchParams(params)}`;
  let pages = 0;
  const MAX_PAGES = 4; // cap to keep tool fast — 1000 orders max per query.

  while (url && pages < MAX_PAGES) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": store.api_token },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Shopify error (${res.status}) for ${store.name}: ${text.slice(0, 200)}`
      );
    }
    const json = await res.json();
    all.push(...(json.orders || []));
    const link = res.headers.get("Link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
    pages++;
  }
  return all;
}

function summarizeOrder(o: RawShopifyOrder, storeName: string) {
  const isCOD = o.gateway?.toLowerCase().includes("cash on delivery");
  const ageDays = Math.floor(
    (Date.now() - new Date(o.created_at).getTime()) / 86400_000
  );
  return {
    order_number: o.name,
    store: storeName,
    created_at: o.created_at,
    total_php: Number(o.total_price),
    currency: o.currency,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status,
    payment_type: isCOD ? "COD" : "Prepaid",
    cancelled: Boolean(o.cancelled_at),
    age_days: ageDays,
    customer: o.customer
      ? `${o.customer.first_name} ${o.customer.last_name}`.trim()
      : null,
    province: o.shipping_address?.province ?? null,
    city: o.shipping_address?.city ?? null,
    items: (o.line_items ?? []).map((l) => ({
      title: l.title,
      variant: l.variant_title,
      qty: l.quantity,
      price: Number(l.price),
      sku: l.sku,
    })),
    tracking:
      o.fulfillments?.[0]?.tracking_number
        ? {
            waybill: o.fulfillments[0].tracking_number,
            courier: o.fulfillments[0].tracking_company,
          }
        : null,
    tags: o.tags ? o.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  };
}

// ─── 1. search_orders ─────────────────────────────────────────────────
export async function searchOrders(
  input: {
    store_name?: string;
    date_filter?: string;
    date_from?: string;
    date_to?: string;
    financial_status?: string;
    fulfillment_status?: string;
    limit?: number;
  },
  ctx: { supabase: SupabaseClient }
) {
  const dateFilter = (input.date_filter ?? "today") as OrderDateFilter;
  const range = computeDateRange(
    dateFilter,
    input.date_from,
    input.date_to
  );
  const stores = await loadStores(ctx.supabase, input.store_name);
  if (stores.length === 0) {
    return { error: `No active Shopify store found${input.store_name ? ` named '${input.store_name}'` : ""}.` };
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  const all: ReturnType<typeof summarizeOrder>[] = [];
  for (const store of stores) {
    try {
      const orders = await shopifyFetchOrders(
        store,
        range.createdAtMin,
        range.createdAtMax,
        input.financial_status,
        input.fulfillment_status
      );
      for (const o of orders) all.push(summarizeOrder(o, store.name));
    } catch (e) {
      console.warn(
        `[ai-shopify] ${store.name} fetch failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  // Sort newest first
  all.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalRevenue = all.reduce((sum, o) => {
    if (o.cancelled) return sum;
    return sum + o.total_php;
  }, 0);
  const unfulfilled = all.filter(
    (o) => !o.fulfillment_status && !o.cancelled
  ).length;
  const cod = all.filter((o) => o.payment_type === "COD" && !o.cancelled).length;
  const cancelled = all.filter((o) => o.cancelled).length;

  return {
    date_range: { from: range.createdAtMin, to: range.createdAtMax },
    stores_queried: stores.map((s) => s.name),
    summary: {
      total_orders: all.length,
      total_revenue_php: Math.round(totalRevenue),
      unfulfilled_count: unfulfilled,
      cod_count: cod,
      cancelled_count: cancelled,
    },
    orders: all.slice(0, limit),
    truncated: all.length > limit,
  };
}

// ─── 2. get_order ─────────────────────────────────────────────────────
export async function getOrder(
  input: { order_number: string; store_name?: string },
  ctx: { supabase: SupabaseClient }
) {
  if (!input.order_number) return { error: "order_number is required" };
  // Shopify order names typically look like "#1234". Normalize + query.
  const stores = await loadStores(ctx.supabase, input.store_name);
  if (stores.length === 0) {
    return { error: "No active Shopify store configured." };
  }
  const normalized = input.order_number.startsWith("#")
    ? input.order_number
    : `#${input.order_number.replace(/^#/, "")}`;

  for (const store of stores) {
    const url = `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders.json?name=${encodeURIComponent(normalized)}&status=any&limit=1`;
    try {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": store.api_token },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { orders?: RawShopifyOrder[] };
      const order = json.orders?.[0];
      if (order) return { found: true, ...summarizeOrder(order, store.name) };
    } catch {
      // try next store
    }
  }
  return { found: false, order_number: normalized };
}

// ─── 3. list_products ─────────────────────────────────────────────────
// Lightweight product listing — pulls product titles + variant stock.
// For deep inventory analysis use the existing /api/shopify/inventory UI.
export async function listProducts(
  input: {
    store_name?: string;
    search?: string;
    low_stock?: boolean;
    low_stock_threshold?: number;
    limit?: number;
  },
  ctx: { supabase: SupabaseClient }
) {
  const stores = await loadStores(ctx.supabase, input.store_name);
  if (stores.length === 0) {
    return { error: "No active Shopify store configured." };
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const threshold = input.low_stock_threshold ?? 10;

  const all: Array<{
    store: string;
    product: string;
    variant: string;
    sku: string | null;
    price: number;
    inventory_quantity: number | null;
    in_stock: boolean;
  }> = [];

  for (const store of stores) {
    const params: Record<string, string> = {
      limit: "250",
      fields: "id,title,variants",
    };
    if (input.search) params.title = input.search;
    let url: string = `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/products.json?${new URLSearchParams(params)}`;
    let pages = 0;
    const MAX_PAGES = 2; // cap — typical catalog fits.
    try {
      while (url && pages < MAX_PAGES) {
        const res = await fetch(url, {
          headers: { "X-Shopify-Access-Token": store.api_token },
          cache: "no-store",
        });
        if (!res.ok) break;
        const json = (await res.json()) as {
          products?: Array<{
            id: number;
            title: string;
            variants: Array<{
              title: string;
              sku: string | null;
              price: string;
              inventory_quantity: number | null;
            }>;
          }>;
        };
        for (const p of json.products ?? []) {
          for (const v of p.variants) {
            const qty = v.inventory_quantity;
            all.push({
              store: store.name,
              product: p.title,
              variant: v.title,
              sku: v.sku,
              price: Number(v.price),
              inventory_quantity: qty,
              in_stock: (qty ?? 0) > 0,
            });
          }
        }
        const link = res.headers.get("Link") || "";
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : "";
        pages++;
      }
    } catch (e) {
      console.warn(
        `[ai-shopify] products ${store.name} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  let filtered = all;
  if (input.low_stock) {
    filtered = filtered.filter(
      (r) => (r.inventory_quantity ?? 0) < threshold
    );
  }

  return {
    stores_queried: stores.map((s) => s.name),
    total_variants: all.length,
    returned: Math.min(filtered.length, limit),
    products: filtered.slice(0, limit),
  };
}
