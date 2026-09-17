import { describe, it, expect } from "vitest";
import { shapeForZeroSpend } from "../ads-payload";

const payload = {
  data: [
    { ad_id: "1", zero_activity: false, spend: 120 },
    { ad_id: "2", zero_activity: true, spend: 0 },
    { ad_id: "3", zero_activity: false, spend: 40 },
    { ad_id: "4", zero_activity: true, spend: 0 },
  ],
  totals: { count: 4, spend: 160, roas: 3.4 },
  accounts: [{ id: "act_1" }],
};

describe("shapeForZeroSpend", () => {
  it("returns the superset untouched when the caller wants zero-spend ads", () => {
    const out = shapeForZeroSpend(payload, true);
    expect(out).toBe(payload);
    expect(out.data).toHaveLength(4);
  });

  it("drops zero-activity rows when the caller did not ask for them", () => {
    const out = shapeForZeroSpend(payload, false);
    expect(out.data.map((r) => r.ad_id)).toEqual(["1", "3"]);
  });

  it("corrects totals.count to the trimmed row count", () => {
    expect(shapeForZeroSpend(payload, false).totals.count).toBe(2);
  });

  it("leaves every other total alone — trimmed rows contribute nothing", () => {
    const { totals } = shapeForZeroSpend(payload, false);
    expect(totals.spend).toBe(160);
    expect(totals.roas).toBe(3.4);
  });

  it("does not mutate the cached payload it was handed", () => {
    shapeForZeroSpend(payload, false);
    expect(payload.data).toHaveLength(4);
    expect(payload.totals.count).toBe(4);
  });

  it("preserves sibling fields such as accounts", () => {
    expect(shapeForZeroSpend(payload, false).accounts).toEqual([{ id: "act_1" }]);
  });

  it("is a no-op when nothing is flagged zero_activity", () => {
    const spendersOnly = {
      data: [{ ad_id: "1", zero_activity: false }],
      totals: { count: 1 },
    };
    expect(shapeForZeroSpend(spendersOnly, false)).toBe(spendersOnly);
  });

  it("survives a payload with no rows or totals", () => {
    expect(shapeForZeroSpend({}, false)).toEqual({});
  });
});
