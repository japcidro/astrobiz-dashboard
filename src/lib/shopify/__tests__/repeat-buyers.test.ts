import { describe, it, expect } from "vitest";
import {
  buildRepeatBuyers,
  buyerKey,
  normalizeEmail,
  normalizePhone,
} from "../repeat-buyers";
import type { ShopifyOrder } from "../types";

const NOW = new Date("2026-09-16T00:00:00+08:00");

function order(overrides: Partial<ShopifyOrder> & { id: number }): ShopifyOrder {
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
    tracking_number: null,
    tracking_url: null,
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
      "3 orders in window",
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
});
