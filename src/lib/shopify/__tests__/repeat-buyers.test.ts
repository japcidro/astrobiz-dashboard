import { describe, it, expect } from "vitest";
import {
  buildRepeatBuyers,
  buyerKey,
  normalizeEmail,
  normalizePhone,
  orderOutcome,
  type OrderParcel,
  type OrderWithParcels,
} from "../repeat-buyers";

const NOW = new Date("2026-09-16T00:00:00+08:00");

function parcel(overrides: Partial<OrderParcel> = {}): OrderParcel {
  return {
    waybill: "JT0000000000001",
    classification: "Delivered",
    is_delivered: true,
    is_returned: false,
    signing_time: "2026-09-03T14:00:00+08:00",
    rts_reason: null,
    cod_amount: 1000,
    ...overrides,
  };
}

const RETURNED = parcel({
  classification: "Returned",
  is_delivered: false,
  is_returned: true,
  signing_time: null,
  rts_reason: "Consignee unreachable",
});

const IN_TRANSIT = parcel({
  classification: "In Transit",
  is_delivered: false,
  is_returned: false,
  signing_time: null,
});

/** Delivered by default — the common case, and what the old tests assumed. */
function order(
  overrides: Partial<OrderWithParcels> & { id: number }
): OrderWithParcels {
  return {
    name: `#${overrides.id}`,
    store_name: "I LOVE PATCHES",
    store_id: "store-1",
    created_at: "2026-09-01T10:00:00+08:00",
    total_price: "1000.00",
    subtotal_price: "1000.00",
    shipping_price: "0",
    total_tax: "0",
    total_discounts: "0",
    currency: "PHP",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    customer_id: null,
    customer_name: "Juan Dela Cruz",
    customer_email: "juan@example.com",
    customer_phone: "09171234567",
    customer_orders_count: 2,
    customer_total_spent: "2000.00",
    shipping_address: "123 Main St, Quezon City, Metro Manila",
    province: "Metro Manila",
    age_days: 15,
    age_level: "normal",
    is_dead: false,
    line_items: [
      {
        id: 1,
        title: "Patch Pack",
        variant_title: null,
        quantity: 2,
        price: "500.00",
        sku: "PP-01",
      },
    ],
    tracking_number: "JT0000000000001",
    tracking_numbers: ["JT0000000000001"],
    tracking_url: null,
    parcels: [parcel()],
    tracking_company: null,
    fulfilled_at: null,
    is_cod: true,
    cancelled_at: null,
    gateway: "COD",
    note: null,
    tags: "",
    discount_codes: [],
    ...overrides,
  };
}

describe("normalizePhone", () => {
  it("reduces every PH mobile shape to the same 10 digits", () => {
    expect(normalizePhone("09171234567")).toBe("9171234567");
    expect(normalizePhone("+63 917 123 4567")).toBe("9171234567");
    expect(normalizePhone("639171234567")).toBe("9171234567");
    expect(normalizePhone("0917-123-4567")).toBe("9171234567");
  });

  it("rejects anything too short to be a real number", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Juan@Example.COM ")).toBe("juan@example.com");
  });

  it("drops placeholder emails that would merge strangers", () => {
    expect(normalizeEmail("noemail@noemail.com")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("buyerKey", () => {
  it("prefers phone over email", () => {
    expect(buyerKey(order({ id: 1 }))).toBe("phone:9171234567");
  });

  it("falls back to email, then customer id, then never groups", () => {
    expect(buyerKey(order({ id: 1, customer_phone: null }))).toBe(
      "email:juan@example.com"
    );
    expect(
      buyerKey(
        order({ id: 1, customer_phone: null, customer_email: "", customer_id: 99 })
      )
    ).toBe("customer:99");
    expect(
      buyerKey(
        order({ id: 7, customer_phone: null, customer_email: "", customer_id: null })
      )
    ).toBe("order:7");
  });
});

describe("buildRepeatBuyers", () => {
  it("keeps only buyers at or above the minimum order count", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({ id: 2, created_at: "2026-09-10T10:00:00+08:00" }),
        order({ id: 3, customer_phone: "09998887777", customer_email: "solo@example.com" }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(buyers).toHaveLength(1);
    expect(buyers[0].orders_count).toBe(2);
    expect(buyers[0].customer_name).toBe("Juan Dela Cruz");
  });

  it("matches the same person across stores by phone", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1, customer_email: "juan@example.com" }),
        order({
          id: 2,
          store_name: "CAPSULED",
          store_id: "store-2",
          customer_phone: "+63 917 123 4567",
          customer_email: "juan.dc@gmail.com",
          created_at: "2026-09-10T10:00:00+08:00",
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(buyers).toHaveLength(1);
    expect(buyers[0].stores).toEqual(["CAPSULED", "I LOVE PATCHES"]);
    expect(buyers[0].emails).toEqual(["juan@example.com", "juan.dc@gmail.com"]);
  });

  it("excludes cancelled orders from money and counts but keeps them visible", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({ id: 2, created_at: "2026-09-10T10:00:00+08:00" }),
        order({
          id: 3,
          created_at: "2026-09-12T10:00:00+08:00",
          is_dead: true,
          total_price: "5000.00",
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    const buyer = buyers[0];
    expect(buyer.orders_count).toBe(2);
    expect(buyer.cancelled_count).toBe(1);
    expect(buyer.total_spent).toBe(2000);
    expect(buyer.total_units).toBe(4);
    expect(buyer.orders).toHaveLength(3);
  });

  it("computes dates, gaps and per-order quantity/SRP", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1, created_at: "2026-09-01T10:00:00+08:00" }),
        order({ id: 2, created_at: "2026-09-11T10:00:00+08:00" }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    const buyer = buyers[0];
    expect(buyer.first_order_at).toBe("2026-09-01T10:00:00+08:00");
    expect(buyer.last_order_at).toBe("2026-09-11T10:00:00+08:00");
    expect(buyer.avg_days_between).toBe(10);
    expect(buyer.days_since_last).toBe(4);
    expect(buyer.avg_order_value).toBe(1000);
    expect(buyer.avg_units_per_order).toBe(2);

    // Newest first, and the newest order knows how long after the previous it came.
    expect(buyer.orders[0].name).toBe("#2");
    expect(buyer.orders[0].days_since_previous).toBe(10);
    expect(buyer.orders[1].days_since_previous).toBeNull();
    expect(buyer.orders[0].line_items[0]).toMatchObject({
      sku: "PP-01",
      quantity: 2,
      unit_price: 500,
      line_total: 1000,
    });
  });

  it("rolls products up across orders with a quantity-weighted average SRP", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({
          id: 2,
          created_at: "2026-09-10T10:00:00+08:00",
          line_items: [
            {
              id: 2,
              title: "Patch Pack",
              variant_title: null,
              quantity: 2,
              price: "400.00",
              sku: "PP-01",
            },
          ],
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    const product = buyers[0].products[0];
    expect(product.sku).toBe("PP-01");
    expect(product.quantity).toBe(4);
    expect(product.revenue).toBe(1800);
    expect(product.avg_unit_price).toBe(450);
    expect(buyers[0].top_product).toBe("Patch Pack");
  });

  it("flags reseller candidates and says why", () => {
    const bulk = order({
      id: 3,
      created_at: "2026-09-12T10:00:00+08:00",
      line_items: [
        {
          id: 3,
          title: "Patch Pack",
          variant_title: null,
          quantity: 8,
          price: "500.00",
          sku: "PP-01",
        },
      ],
    });

    const { buyers, summary } = buildRepeatBuyers(
      [order({ id: 1 }), order({ id: 2, created_at: "2026-09-10T10:00:00+08:00" }), bulk],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    const buyer = buyers[0];
    expect(buyer.is_reseller_candidate).toBe(true);
    expect(buyer.reseller_reasons).toEqual([
      "3 delivered orders",
      "12 units bought",
      "bulk order of 8 units",
    ]);
    expect(buyer.largest_order_units).toBe(8);
    expect(summary.reseller_candidates).toBe(1);
  });

  it("reports repeat share against every buyer in the window", () => {
    const { summary } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({ id: 2, created_at: "2026-09-10T10:00:00+08:00" }),
        order({
          id: 3,
          customer_phone: "09998887777",
          customer_email: "solo@example.com",
          total_price: "2000.00",
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(summary.total_buyers).toBe(2);
    expect(summary.repeat_buyers).toBe(1);
    expect(summary.repeat_rate_pct).toBe(50);
    expect(summary.total_orders).toBe(3);
    expect(summary.repeat_orders).toBe(2);
    expect(summary.total_revenue).toBe(4000);
    expect(summary.repeat_revenue).toBe(2000);
    expect(summary.repeat_revenue_pct).toBe(50);
  });

  it("drops a buyer whose only orders are cancelled", () => {
    const { buyers, summary } = buildRepeatBuyers(
      [
        order({ id: 1, is_dead: true }),
        order({ id: 2, created_at: "2026-09-10T10:00:00+08:00", is_dead: true }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(buyers).toHaveLength(0);
    expect(summary.total_buyers).toBe(0);
  });
  it("counts only what J&T delivered, not what Shopify accepted", () => {
    const { buyers, summary } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({ id: 2, created_at: "2026-09-05T10:00:00+08:00" }),
        // Ordered and shipped, but came straight back — never a sale.
        order({
          id: 3,
          created_at: "2026-09-08T10:00:00+08:00",
          total_price: "1500.00",
          parcels: [RETURNED],
        }),
        // Still out with the courier — not money yet either.
        order({
          id: 4,
          created_at: "2026-09-14T10:00:00+08:00",
          parcels: [IN_TRANSIT],
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    const buyer = buyers[0];
    expect(buyer.orders_count).toBe(2);
    expect(buyer.delivered_count).toBe(2);
    expect(buyer.rts_count).toBe(1);
    expect(buyer.in_transit_count).toBe(1);
    expect(buyer.total_spent).toBe(2000);
    // 1 of 3 resolved parcels came back.
    expect(buyer.rts_rate_pct).toBe(33.33);
    expect(buyer.rts_value).toBe(1500);
    // Everything stays visible in the drawer, flagged by outcome.
    expect(buyer.orders).toHaveLength(4);
    expect(buyer.orders.map((o) => o.outcome)).toEqual([
      "in_transit",
      "returned",
      "delivered",
      "delivered",
    ]);
    expect(summary.delivered_orders).toBe(2);
    expect(summary.returned_orders).toBe(1);
    expect(summary.rts_value).toBe(1500);
  });

  it("drops a buyer whose parcels all came back", () => {
    const { buyers } = buildRepeatBuyers(
      [
        order({ id: 1, parcels: [RETURNED] }),
        order({
          id: 2,
          created_at: "2026-09-10T10:00:00+08:00",
          parcels: [RETURNED],
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(buyers).toHaveLength(0);
  });

  it("treats an order with no parcel on file as unverified, not delivered", () => {
    const orders = [
      order({ id: 1, tracking_numbers: [], tracking_number: null, parcels: [] }),
      order({
        id: 2,
        created_at: "2026-09-10T10:00:00+08:00",
        tracking_numbers: [],
        tracking_number: null,
        parcels: [],
      }),
    ];

    const delivered = buildRepeatBuyers(orders, {
      minOrders: 2,
      windowDays: 180,
      now: NOW,
    });
    expect(delivered.buyers).toHaveLength(0);
    expect(delivered.summary.unverified_orders).toBe(2);
    expect(delivered.summary.parcel_coverage_pct).toBe(0);

    // "all" mode falls back to the Shopify view for when uploads are behind.
    const all = buildRepeatBuyers(orders, {
      minOrders: 2,
      windowDays: 180,
      countMode: "all",
      now: NOW,
    });
    expect(all.buyers).toHaveLength(1);
    expect(all.buyers[0].orders_count).toBe(2);
    expect(all.buyers[0].delivered_count).toBe(0);
  });

  it("counts a split shipment as delivered when any box landed", () => {
    const split = order({
      id: 1,
      tracking_numbers: ["JT-A", "JT-B"],
      parcels: [
        parcel({ waybill: "JT-A" }),
        parcel({
          waybill: "JT-B",
          classification: "Returned",
          is_delivered: false,
          is_returned: true,
        }),
      ],
    });

    expect(orderOutcome(split)).toBe("delivered");
  });

  it("reports parcel coverage over shippable orders only", () => {
    const { summary } = buildRepeatBuyers(
      [
        order({ id: 1 }),
        order({ id: 2, created_at: "2026-09-05T10:00:00+08:00" }),
        order({
          id: 3,
          created_at: "2026-09-08T10:00:00+08:00",
          tracking_numbers: [],
          parcels: [],
        }),
        // Cancelled before it ever shipped — not a coverage gap.
        order({
          id: 4,
          created_at: "2026-09-09T10:00:00+08:00",
          is_dead: true,
          tracking_numbers: [],
          parcels: [],
        }),
      ],
      { minOrders: 2, windowDays: 180, now: NOW }
    );

    expect(summary.cancelled_orders).toBe(1);
    expect(summary.unverified_orders).toBe(1);
    // 3 shippable, 2 with parcels.
    expect(summary.parcel_coverage_pct).toBe(66.67);
  });
});
