import { describe, it, expect } from "vitest";
import { lookupOrderForWaybill, type OrderMatch } from "../tracking-to-order";

const sample: OrderMatch = {
  shopify_order_id: "12345",
  shopify_order_name: "#1001",
  shopify_order_date: "2026-04-19",
  shopify_customer_email: "buyer@example.com",
  store_name: "CAPSULED",
};

describe("lookupOrderForWaybill", () => {
  it("matches exact upper-case waybill", () => {
    const map = new Map([["JT0016580144458", sample]]);
    expect(lookupOrderForWaybill(map, "JT0016580144458")).toEqual(sample);
  });

  it("normalizes lowercase input — VAs sometimes type lowercase", () => {
    const map = new Map([["JT0016580144458", sample]]);
    expect(lookupOrderForWaybill(map, "jt0016580144458")).toEqual(sample);
  });

  it("trims whitespace — trailing spaces are common in CSV pastes", () => {
    const map = new Map([["JT0016580144458", sample]]);
    expect(lookupOrderForWaybill(map, "  JT0016580144458  ")).toEqual(sample);
  });

  it("returns null for an empty waybill instead of throwing", () => {
    const map = new Map([["JT0016580144458", sample]]);
    expect(lookupOrderForWaybill(map, "")).toBeNull();
    expect(lookupOrderForWaybill(map, "   ")).toBeNull();
  });

  it("returns null when the waybill isn't in the map", () => {
    const map = new Map([["JT0016580144458", sample]]);
    expect(lookupOrderForWaybill(map, "JT9999999999999")).toBeNull();
  });

  it("does not coerce a different-but-similar waybill", () => {
    const map = new Map([["JT0016580144458", sample]]);
    // One digit off — must not match.
    expect(lookupOrderForWaybill(map, "JT0016580144459")).toBeNull();
  });
});
