import type { ShopifyOrder } from "@/lib/shopify/types";

export const SHOPIFY_API_VERSION = "2024-01";

// The exact field set both /api/shopify/orders and /api/shopify/repeat-buyers
// need. Kept in one place so the two screens can never drift onto different
// slices of the same order.
const ORDER_FIELDS =
  "id,name,created_at,total_price,subtotal_price,total_shipping_price_set,total_tax,total_discounts,currency,financial_status,fulfillment_status,customer,shipping_address,line_items,fulfillments,cancelled_at,gateway,note,tags,discount_codes";

export interface RawShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  subtotal_price: string;
  total_shipping_price_set: { shop_money: { amount: string } } | null;
  total_tax: string;
  total_discounts: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    orders_count: number;
    total_spent: string;
  } | null;
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone: string | null;
  } | null;
  line_items: {
    id: number;
    title: string;
    variant_title: string | null;
    quantity: number;
    price: string;
    sku: string | null;
  }[];
  fulfillments:
    | {
        created_at: string;
        tracking_number: string | null;
        tracking_url: string | null;
        tracking_company: string | null;
      }[]
    | null;
  cancelled_at: string | null;
  gateway: string;
  note: string | null;
  tags: string;
  discount_codes: { code: string; amount: string; type: string }[];
}

export async function shopifyFetchOrders(
  storeUrl: string,
  apiToken: string,
  createdAtMin: string,
  createdAtMax: string
): Promise<RawShopifyOrder[]> {
  const allOrders: RawShopifyOrder[] = [];
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: "any",
      created_at_min: createdAtMin,
      created_at_max: createdAtMax,
      limit: "250",
      fields: ORDER_FIELDS,
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

// An order is "dead" when no further fulfillment work is expected:
// manually cancelled, voided (COD declined), or fully refunded.
// Also treats explicit cancel tags as dead for stores that manage this via tags.
export function isDeadOrder(args: {
  cancelledAt: string | null;
  financialStatus: string;
  tags: string;
}): boolean {
  if (args.cancelledAt) return true;
  const fs = (args.financialStatus || "").toLowerCase();
  if (fs === "voided" || fs === "refunded") return true;
  const tags = (args.tags || "").toLowerCase();
  if (/\b(cancelled|canceled|void|voided|refunded|deleted)\b/.test(tags)) return true;
  return false;
}

export function computeAgeLevel(
  fulfillmentStatus: string | null,
  isDead: boolean,
  ageDays: number
): "normal" | "warning" | "danger" {
  if (fulfillmentStatus === "fulfilled" || isDead) return "normal";
  if (ageDays >= 5) return "danger";
  if (ageDays >= 3) return "warning";
  return "normal";
}

/**
 * Normalize one raw Shopify order into the app-wide `ShopifyOrder` shape.
 * Every screen that reads orders goes through here, so "dead", "COD" and the
 * aging thresholds mean the same thing everywhere.
 */
export function toShopifyOrder(
  raw: RawShopifyOrder,
  store: { id: string; name: string },
  now: Date
): ShopifyOrder {
  const ageDays = Math.floor(
    (now.getTime() - new Date(raw.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const dead = isDeadOrder({
    cancelledAt: raw.cancelled_at,
    financialStatus: raw.financial_status || "",
    tags: raw.tags || "",
  });

  const sa = raw.shipping_address;
  const fullAddress = sa
    ? [sa.address1, sa.address2, sa.city, sa.province, sa.zip, sa.country]
        .filter(Boolean)
        .join(", ")
    : null;

  // Shipping address names are the fallback identity for guest checkouts —
  // PH COD stores often have no customer record attached to the order.
  const customerName = raw.customer
    ? `${raw.customer.first_name || ""} ${raw.customer.last_name || ""}`.trim()
    : sa
      ? `${sa.first_name || ""} ${sa.last_name || ""}`.trim()
      : "";

  return {
    id: raw.id,
    name: raw.name,
    store_name: store.name,
    store_id: store.id,
    created_at: raw.created_at,
    total_price: raw.total_price,
    subtotal_price: raw.subtotal_price || raw.total_price,
    shipping_price: raw.total_shipping_price_set?.shop_money?.amount || "0",
    total_tax: raw.total_tax || "0",
    total_discounts: raw.total_discounts || "0",
    currency: raw.currency || "PHP",
    financial_status: raw.financial_status || "pending",
    fulfillment_status: raw.fulfillment_status,
    customer_id: raw.customer?.id ?? null,
    customer_name: customerName || "Unknown",
    customer_email: raw.customer?.email || "",
    customer_phone: raw.customer?.phone || sa?.phone || null,
    customer_orders_count: raw.customer?.orders_count || 0,
    customer_total_spent: raw.customer?.total_spent || "0",
    shipping_address: fullAddress,
    province: sa?.province || "—",
    age_days: ageDays,
    age_level: computeAgeLevel(raw.fulfillment_status, dead, ageDays),
    is_dead: dead,
    line_items: (raw.line_items || []).map((li) => ({
      id: li.id,
      title: li.title,
      variant_title: li.variant_title || null,
      quantity: li.quantity,
      price: li.price,
      sku: li.sku || null,
    })),
    tracking_number: raw.fulfillments?.[0]?.tracking_number || null,
    tracking_url: raw.fulfillments?.[0]?.tracking_url || null,
    tracking_company: raw.fulfillments?.[0]?.tracking_company || null,
    fulfilled_at: raw.fulfillments?.[0]?.created_at || null,
    is_cod:
      (raw.gateway || "").toLowerCase().includes("cod") ||
      (raw.gateway || "").toLowerCase().includes("cash on delivery"),
    cancelled_at: raw.cancelled_at,
    gateway: raw.gateway || "",
    note: raw.note || null,
    tags: raw.tags || "",
    discount_codes: raw.discount_codes || [],
  };
}
