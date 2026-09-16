import type { ShopifyOrder } from "@/lib/shopify/types";

/**
 * Repeat-buyer rollup.
 *
 * Shopify's own `customer.orders_count` is per-store and lifetime, so it can't
 * answer "who is buying from us again, across our brands, inside this window".
 *
 * More importantly, a Shopify order is not a sale. On COD it is a promise: the
 * money only exists once J&T hands the parcel over and someone pays. An order
 * that was cancelled, or shipped and returned to sender, looks identical to a
 * real purchase in Shopify. So the default here counts **delivered parcels**,
 * joined back to their Shopify order for the things J&T does not carry —
 * phone number, SKU, and the SRP actually charged.
 *
 * Shopify supplies identity and line items; J&T supplies the truth about
 * whether the purchase happened.
 */

// A buyer crossing any one of these is flagged as a reseller candidate.
export const RESELLER_MIN_ORDERS = 3;
export const RESELLER_MIN_UNITS = 10;
export const RESELLER_BULK_ORDER_UNITS = 5;

/** One J&T parcel, as matched to a Shopify order by waybill. */
export interface OrderParcel {
  waybill: string;
  classification: string;
  is_delivered: boolean;
  is_returned: boolean;
  signing_time: string | null;
  rts_reason: string | null;
  cod_amount: number;
}

/** What actually became of an order, once its parcels are known. */
export type DeliveryOutcome =
  | "delivered" // J&T handed it over — a real purchase
  | "returned" // RTS, or heading back — no money, and it cost shipping
  | "in_transit" // out with J&T, not yet resolved
  | "cancelled" // killed in Shopify before it ever shipped
  | "unverified"; // no J&T parcel on file — not shipped by J&T, or not uploaded yet

/**
 * "delivered" counts only J&T-confirmed purchases — the honest view, and the
 * default. "all" counts every live Shopify order the way the order screens do,
 * for when the J&T upload is behind and you need to see the shape anyway.
 */
export type CountMode = "delivered" | "all";

export type OrderWithParcels = ShopifyOrder & { parcels: OrderParcel[] };

/**
 * Resolve an order against its parcels. A split shipment where one box landed
 * and another came back counts as delivered: the customer received goods and
 * paid for them. The return still shows up in the buyer's RTS value.
 */
export function orderOutcome(order: OrderWithParcels): DeliveryOutcome {
  if (order.is_dead) return "cancelled";
  if (order.parcels.length === 0) return "unverified";
  if (order.parcels.some((p) => p.is_delivered)) return "delivered";
  if (order.parcels.some((p) => p.is_returned)) return "returned";
  return "in_transit";
}

export type RepeatBuyerSort =
  | "total_spent"
  | "orders_count"
  | "rts_count"
  | "total_units"
  | "last_order_at"
  | "first_order_at"
  | "avg_order_value"
  | "days_since_last"
  | "avg_days_between"
  | "customer_name";

export interface RepeatBuyerLineItem {
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number; // SRP charged per unit on that order
  line_total: number;
}

export interface RepeatBuyerOrder {
  id: number;
  name: string;
  store_name: string;
  created_at: string;
  total_price: number;
  units: number;
  financial_status: string;
  fulfillment_status: string | null;
  is_cod: boolean;
  is_dead: boolean;
  province: string;
  shipping_address: string | null;
  discount_codes: string[];
  line_items: RepeatBuyerLineItem[];
  // Days since this buyer's previous counted order. null on their first one.
  days_since_previous: number | null;
  outcome: DeliveryOutcome;
  waybills: string[];
  signed_at: string | null;
  rts_reason: string | null;
  /** Whether this order fed the buyer's totals under the active count mode. */
  counted: boolean;
}

export interface RepeatBuyerProduct {
  key: string;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  revenue: number;
  avg_unit_price: number; // weighted by quantity — what they actually pay per unit
  last_ordered_at: string;
}

export interface RepeatBuyer {
  key: string;
  customer_name: string;
  emails: string[];
  phones: string[];
  stores: string[];
  province: string;
  latest_address: string | null;
  orders_count: number; // counted purchases under the active count mode
  delivered_count: number;
  rts_count: number;
  in_transit_count: number;
  unverified_count: number;
  cancelled_count: number; // cancelled / voided / refunded in Shopify
  /** Share of resolved parcels (delivered + returned) that came back. */
  rts_rate_pct: number | null;
  /** Order value J&T sent back — shipping paid, nothing earned. */
  rts_value: number;
  total_units: number;
  total_spent: number;
  avg_order_value: number;
  avg_units_per_order: number;
  largest_order_units: number;
  largest_order_value: number;
  first_order_at: string;
  last_order_at: string;
  days_since_last: number;
  avg_days_between: number | null; // null when there is only one counted order
  cod_count: number;
  prepaid_count: number;
  discount_codes: string[];
  top_product: string | null;
  // Highest lifetime order count Shopify reports for this buyer on any store —
  // catches someone whose history reaches back past the selected window.
  lifetime_orders_count: number;
  is_reseller_candidate: boolean;
  reseller_reasons: string[];
  orders: RepeatBuyerOrder[];
  products: RepeatBuyerProduct[];
}

export interface RepeatBuyersSummary {
  window_days: number;
  min_orders: number;
  count_mode: CountMode;
  total_buyers: number;
  repeat_buyers: number;
  repeat_rate_pct: number;
  reseller_candidates: number;
  total_orders: number;
  repeat_orders: number;
  total_revenue: number;
  repeat_revenue: number;
  repeat_revenue_pct: number;
  repeat_units: number;
  avg_orders_per_repeat_buyer: number;
  avg_repeat_buyer_value: number;
  avg_days_between_orders: number | null;
  /** Every Shopify order in the window, by what became of it. */
  delivered_orders: number;
  returned_orders: number;
  in_transit_orders: number;
  unverified_orders: number;
  cancelled_orders: number;
  /** Share of shipped orders that reached a J&T parcel record at all. */
  parcel_coverage_pct: number;
  /** Window-wide RTS rate across resolved parcels. */
  rts_rate_pct: number | null;
  rts_value: number;
}

// Placeholder addresses some storefronts auto-fill for COD checkouts. Grouping
// on them would merge unrelated people into one giant fake "buyer".
const PLACEHOLDER_EMAILS = new Set([
  "noemail@noemail.com",
  "no@email.com",
  "none@none.com",
  "na@na.com",
  "cod@cod.com",
  "test@test.com",
]);

/**
 * PH mobile numbers arrive as 09171234567, +639171234567, 639171234567 or with
 * spaces and dashes. Reduce every shape to the last 10 digits so the same
 * person matches across stores and checkouts.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!email.includes("@")) return null;
  if (PLACEHOLDER_EMAILS.has(email)) return null;
  return email;
}

/**
 * Identity for grouping, strongest signal first. Phone beats email because PH
 * COD checkouts reuse throwaway emails far more often than throwaway numbers.
 * An order with none of the three groups with nothing — it can never be
 * mistaken for a repeat.
 */
export function buyerKey(order: ShopifyOrder): string {
  const phone = normalizePhone(order.customer_phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(order.customer_email);
  if (email) return `email:${email}`;
  if (order.customer_id) return `customer:${order.customer_id}`;
  return `order:${order.id}`;
}

function productKey(item: { sku: string | null; title: string; variant_title: string | null }) {
  if (item.sku) return `sku:${item.sku}`;
  return `title:${item.title}${item.variant_title ? ` / ${item.variant_title}` : ""}`;
}

function daysBetween(laterIso: string, earlierIso: string): number {
  return Math.round(
    (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushUnique(list: string[], value: string | null | undefined) {
  if (value && !list.includes(value)) list.push(value);
}

interface Accumulator {
  key: string;
  names: string[];
  emails: string[];
  phones: string[];
  stores: string[];
  discountCodes: string[];
  lifetimeOrdersCount: number;
  orders: (RepeatBuyerOrder & { _sortMs: number })[];
}

export interface BuildRepeatBuyersOptions {
  minOrders: number;
  windowDays: number;
  countMode?: CountMode;
  now?: Date;
}

/** Does this order count as a purchase under the active mode? */
function isCounted(outcome: DeliveryOutcome, countMode: CountMode): boolean {
  if (countMode === "delivered") return outcome === "delivered";
  return outcome !== "cancelled";
}

/**
 * Group a window of orders into buyers, keeping only those with `minOrders`
 * counted purchases.
 *
 * Under the default "delivered" mode a purchase means a parcel J&T actually
 * handed over. Orders that were cancelled, returned to sender, still in
 * transit, or have no parcel on file stay attached to the buyer — visible, and
 * counted in their RTS rate — but never feed orders, units or money.
 */
export function buildRepeatBuyers(
  orders: OrderWithParcels[],
  {
    minOrders,
    windowDays,
    countMode = "delivered",
    now = new Date(),
  }: BuildRepeatBuyersOptions
): { buyers: RepeatBuyer[]; summary: RepeatBuyersSummary } {
  const groups = new Map<string, Accumulator>();

  for (const order of orders) {
    const key = buyerKey(order);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        key,
        names: [],
        emails: [],
        phones: [],
        stores: [],
        discountCodes: [],
        lifetimeOrdersCount: 0,
        orders: [],
      };
      groups.set(key, acc);
    }

    if (order.customer_name && order.customer_name !== "Unknown") {
      pushUnique(acc.names, order.customer_name);
    }
    pushUnique(acc.emails, normalizeEmail(order.customer_email));
    pushUnique(acc.phones, normalizePhone(order.customer_phone));
    pushUnique(acc.stores, order.store_name);
    for (const dc of order.discount_codes || []) pushUnique(acc.discountCodes, dc.code);
    acc.lifetimeOrdersCount = Math.max(
      acc.lifetimeOrdersCount,
      order.customer_orders_count || 0
    );

    const lineItems: RepeatBuyerLineItem[] = (order.line_items || []).map((li) => {
      const unitPrice = parseFloat(li.price) || 0;
      return {
        title: li.title,
        variant_title: li.variant_title,
        sku: li.sku,
        quantity: li.quantity,
        unit_price: round2(unitPrice),
        line_total: round2(unitPrice * li.quantity),
      };
    });

    const outcome = orderOutcome(order);

    acc.orders.push({
      id: order.id,
      name: order.name,
      store_name: order.store_name,
      created_at: order.created_at,
      total_price: round2(parseFloat(order.total_price) || 0),
      units: lineItems.reduce((sum, li) => sum + li.quantity, 0),
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      is_cod: order.is_cod,
      is_dead: order.is_dead,
      province: order.province,
      shipping_address: order.shipping_address,
      discount_codes: (order.discount_codes || []).map((dc) => dc.code),
      line_items: lineItems,
      days_since_previous: null, // filled in once the buyer's orders are sorted
      outcome,
      waybills: order.parcels.map((p) => p.waybill),
      signed_at:
        order.parcels.find((p) => p.is_delivered)?.signing_time ?? null,
      rts_reason:
        order.parcels.find((p) => p.is_returned)?.rts_reason ?? null,
      counted: isCounted(outcome, countMode),
      _sortMs: new Date(order.created_at).getTime(),
    });
  }

  const allBuyers: RepeatBuyer[] = [];

  for (const acc of groups.values()) {
    // Oldest first so gaps between purchases read forward in time.
    acc.orders.sort((a, b) => a._sortMs - b._sortMs);

    const live = acc.orders.filter((o) => o.counted);
    if (live.length === 0) continue; // never actually bought anything

    let previousIso: string | null = null;
    const gaps: number[] = [];
    for (const order of acc.orders) {
      if (!order.counted) continue;
      order.days_since_previous = previousIso
        ? daysBetween(order.created_at, previousIso)
        : null;
      if (order.days_since_previous !== null) gaps.push(order.days_since_previous);
      previousIso = order.created_at;
    }

    const delivered = acc.orders.filter((o) => o.outcome === "delivered");
    const returned = acc.orders.filter((o) => o.outcome === "returned");
    const resolved = delivered.length + returned.length;
    const rtsValue = returned.reduce((sum, o) => sum + o.total_price, 0);

    const totalSpent = live.reduce((sum, o) => sum + o.total_price, 0);
    const totalUnits = live.reduce((sum, o) => sum + o.units, 0);
    const firstOrderAt = live[0].created_at;
    const lastOrderAt = live[live.length - 1].created_at;

    // Product rollup across the buyer's live orders.
    const productMap = new Map<string, RepeatBuyerProduct>();
    for (const order of live) {
      for (const li of order.line_items) {
        const pk = productKey(li);
        const existing = productMap.get(pk);
        if (existing) {
          existing.quantity += li.quantity;
          existing.revenue = round2(existing.revenue + li.line_total);
          existing.avg_unit_price = round2(existing.revenue / existing.quantity);
          if (order.created_at > existing.last_ordered_at) {
            existing.last_ordered_at = order.created_at;
          }
        } else {
          productMap.set(pk, {
            key: pk,
            title: li.title,
            variant_title: li.variant_title,
            sku: li.sku,
            quantity: li.quantity,
            revenue: li.line_total,
            avg_unit_price: li.unit_price,
            last_ordered_at: order.created_at,
          });
        }
      }
    }
    const products = Array.from(productMap.values()).sort(
      (a, b) => b.quantity - a.quantity || b.revenue - a.revenue
    );

    const largestOrderUnits = Math.max(...live.map((o) => o.units));
    const largestOrderValue = Math.max(...live.map((o) => o.total_price));

    const reasons: string[] = [];
    if (live.length >= RESELLER_MIN_ORDERS) {
      reasons.push(
        countMode === "delivered"
          ? `${live.length} delivered orders`
          : `${live.length} orders in window`
      );
    }
    if (totalUnits >= RESELLER_MIN_UNITS) {
      reasons.push(`${totalUnits} units bought`);
    }
    if (largestOrderUnits >= RESELLER_BULK_ORDER_UNITS) {
      reasons.push(`bulk order of ${largestOrderUnits} units`);
    }

    allBuyers.push({
      key: acc.key,
      customer_name: acc.names[0] || "Unknown",
      emails: acc.emails,
      phones: acc.phones,
      stores: acc.stores.sort(),
      province: live[live.length - 1].province,
      latest_address: live[live.length - 1].shipping_address,
      orders_count: live.length,
      delivered_count: delivered.length,
      rts_count: returned.length,
      in_transit_count: acc.orders.filter((o) => o.outcome === "in_transit").length,
      unverified_count: acc.orders.filter((o) => o.outcome === "unverified").length,
      cancelled_count: acc.orders.filter((o) => o.outcome === "cancelled").length,
      rts_rate_pct: resolved > 0 ? round2((returned.length / resolved) * 100) : null,
      rts_value: round2(rtsValue),
      total_units: totalUnits,
      total_spent: round2(totalSpent),
      avg_order_value: round2(totalSpent / live.length),
      avg_units_per_order: round2(totalUnits / live.length),
      largest_order_units: largestOrderUnits,
      largest_order_value: largestOrderValue,
      first_order_at: firstOrderAt,
      last_order_at: lastOrderAt,
      days_since_last: Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(lastOrderAt).getTime()) / (1000 * 60 * 60 * 24)
        )
      ),
      avg_days_between:
        gaps.length > 0
          ? round2(gaps.reduce((a, b) => a + b, 0) / gaps.length)
          : null,
      cod_count: live.filter((o) => o.is_cod).length,
      prepaid_count: live.filter((o) => !o.is_cod).length,
      discount_codes: acc.discountCodes,
      top_product: products[0]?.title ?? null,
      lifetime_orders_count: acc.lifetimeOrdersCount,
      is_reseller_candidate: reasons.length > 0,
      reseller_reasons: reasons,
      orders: acc.orders
        .slice()
        .reverse() // newest first for display
        .map(({ _sortMs, ...rest }) => {
          void _sortMs;
          return rest;
        }),
      products,
    });
  }

  const repeats = allBuyers.filter((b) => b.orders_count >= minOrders);

  // Outcome counts run over every order in the window, including those whose
  // buyer never repeated — coverage is a property of the data, not the list.
  const outcomes = orders.map(orderOutcome);
  const countOutcome = (o: DeliveryOutcome) =>
    outcomes.filter((v) => v === o).length;
  const deliveredOrders = countOutcome("delivered");
  const returnedOrders = countOutcome("returned");
  const unverifiedOrders = countOutcome("unverified");
  const cancelledOrders = countOutcome("cancelled");
  const inTransitOrders = countOutcome("in_transit");
  const resolvedOrders = deliveredOrders + returnedOrders;
  // Cancelled orders never ship, so they are not a coverage gap.
  const shippableOrders = orders.length - cancelledOrders;
  const windowRtsValue = orders
    .filter((o) => orderOutcome(o) === "returned")
    .reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);

  const totalOrders = allBuyers.reduce((sum, b) => sum + b.orders_count, 0);
  const totalRevenue = allBuyers.reduce((sum, b) => sum + b.total_spent, 0);
  const repeatOrders = repeats.reduce((sum, b) => sum + b.orders_count, 0);
  const repeatRevenue = repeats.reduce((sum, b) => sum + b.total_spent, 0);
  const repeatUnits = repeats.reduce((sum, b) => sum + b.total_units, 0);
  const gapValues = repeats
    .map((b) => b.avg_days_between)
    .filter((v): v is number => v !== null);

  const summary: RepeatBuyersSummary = {
    window_days: windowDays,
    min_orders: minOrders,
    count_mode: countMode,
    total_buyers: allBuyers.length,
    repeat_buyers: repeats.length,
    repeat_rate_pct:
      allBuyers.length > 0
        ? round2((repeats.length / allBuyers.length) * 100)
        : 0,
    reseller_candidates: repeats.filter((b) => b.is_reseller_candidate).length,
    total_orders: totalOrders,
    repeat_orders: repeatOrders,
    total_revenue: round2(totalRevenue),
    repeat_revenue: round2(repeatRevenue),
    repeat_revenue_pct:
      totalRevenue > 0 ? round2((repeatRevenue / totalRevenue) * 100) : 0,
    repeat_units: repeatUnits,
    avg_orders_per_repeat_buyer:
      repeats.length > 0 ? round2(repeatOrders / repeats.length) : 0,
    avg_repeat_buyer_value:
      repeats.length > 0 ? round2(repeatRevenue / repeats.length) : 0,
    avg_days_between_orders:
      gapValues.length > 0
        ? round2(gapValues.reduce((a, b) => a + b, 0) / gapValues.length)
        : null,
    delivered_orders: deliveredOrders,
    returned_orders: returnedOrders,
    in_transit_orders: inTransitOrders,
    unverified_orders: unverifiedOrders,
    cancelled_orders: cancelledOrders,
    parcel_coverage_pct:
      shippableOrders > 0
        ? round2(
            ((shippableOrders - unverifiedOrders) / shippableOrders) * 100
          )
        : 0,
    rts_rate_pct:
      resolvedOrders > 0
        ? round2((returnedOrders / resolvedOrders) * 100)
        : null,
    rts_value: round2(windowRtsValue),
  };

  // Default order: biggest spenders first — the list a CEO scans top-down.
  repeats.sort((a, b) => b.total_spent - a.total_spent);

  return { buyers: repeats, summary };
}
