import type { SupabaseClient } from "@supabase/supabase-js";

const SHOPIFY_API_VERSION = "2024-01";

export interface OrderMatch {
  shopify_order_id: string;
  shopify_order_name: string;
  // PHT calendar date — normalized so matching is timezone-stable.
  shopify_order_date: string;
  shopify_customer_email: string | null;
  store_name: string;
}

function phtDateString(d: Date): string {
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, "0")}-${String(pht.getUTCDate()).padStart(2, "0")}`;
}

interface ShopifyOrderForTracking {
  id: number;
  name: string;
  created_at: string;
  customer: { email: string | null } | null;
  fulfillments: Array<{ tracking_number: string | null }> | null;
}

interface ActiveStore {
  id: string;
  name: string;
  store_url: string;
  api_token: string;
}

async function fetchOrdersForStore(
  store: ActiveStore,
  createdAtMin: string
): Promise<Array<[string, OrderMatch]>> {
  const entries: Array<[string, OrderMatch]> = [];
  let url: string =
    `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: "any",
      created_at_min: createdAtMin,
      limit: "250",
      fields: "id,name,created_at,customer,fulfillments",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": store.api_token },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(
        `[tracking-to-order] ${store.name} fetch failed (${res.status})`
      );
      break;
    }
    const json = (await res.json()) as { orders?: ShopifyOrderForTracking[] };
    for (const order of json.orders ?? []) {
      const orderInfo: OrderMatch = {
        shopify_order_id: String(order.id),
        shopify_order_name: order.name || `#${order.id}`,
        shopify_order_date: phtDateString(new Date(order.created_at)),
        shopify_customer_email: order.customer?.email ?? null,
        store_name: store.name,
      };
      for (const f of order.fulfillments ?? []) {
        const tn = (f.tracking_number || "").trim().toUpperCase();
        if (tn) entries.push([tn, orderInfo]);
      }
    }
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return entries;
}

/**
 * Build tracking_number → Shopify order metadata map across all active stores.
 *
 * Used by:
 *   - /api/profit/jt-upload — stamp shopify_* fields on each row at upload time
 *   - /api/admin/jt-backfill-shopify-link — retroactively populate older rows
 *
 * Tracking numbers are normalized to upper-case and trimmed because pick-pack
 * VAs occasionally enter waybills with stray spaces or in lowercase. J&T's
 * canonical form is upper-case (e.g. JT0016580144458).
 *
 * Note on multi-fulfillment orders: a single Shopify order can have several
 * fulfillments (and so multiple tracking numbers). Each tracking maps to the
 * SAME order metadata — that's the desired behavior, since both parcels
 * belong to one order.
 */
export async function buildTrackingToOrderMap(
  supabase: SupabaseClient,
  daysBack: number = 30
): Promise<Map<string, OrderMatch>> {
  const map = new Map<string, OrderMatch>();

  const { data: stores } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (!stores || stores.length === 0) return map;

  const sinceUtc = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000
  ).toISOString();

  const perStoreEntries = await Promise.all(
    (stores as ActiveStore[]).map((store) => fetchOrdersForStore(store, sinceUtc))
  );

  for (const entries of perStoreEntries) {
    for (const [tn, info] of entries) {
      // Last-write-wins is fine: same waybill across stores is impossible
      // in practice (J&T issues unique waybills per parcel).
      map.set(tn, info);
    }
  }

  return map;
}

export function lookupOrderForWaybill(
  map: Map<string, OrderMatch>,
  waybill: string
): OrderMatch | null {
  const key = (waybill || "").trim().toUpperCase();
  if (!key) return null;
  return map.get(key) ?? null;
}
