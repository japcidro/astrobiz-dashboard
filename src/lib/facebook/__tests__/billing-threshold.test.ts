import { describe, it, expect } from "vitest";
import {
  parseThresholdConfig,
  resolveThreshold,
  withAccountThreshold,
  thresholdStatus,
  shouldAlert,
  describeThresholdAlert,
  describePaymentFailedAlert,
  parseThresholdState,
  advanceCycle,
  DEFAULT_THRESHOLD_CONFIG,
} from "../billing-threshold";

describe("parseThresholdConfig", () => {
  it("defaults to ₱50,000 with the warning at ₱40,000", () => {
    expect(parseThresholdConfig(null)).toEqual(DEFAULT_THRESHOLD_CONFIG);
    expect(DEFAULT_THRESHOLD_CONFIG.default).toEqual({ limit: 50000, alert_at: 40000 });
  });

  it("survives junk and partial rows", () => {
    expect(parseThresholdConfig("not json")).toEqual(DEFAULT_THRESHOLD_CONFIG);
    expect(parseThresholdConfig('{"accounts":{"act_1":{"limit":"abc"},"act_2":{"limit":"30000"}}}'))
      .toEqual({ default: { limit: 50000, alert_at: 40000 }, accounts: { act_2: { limit: 30000 } } });
  });

  it("derives a default alert level when only the limit is stored", () => {
    const cfg = parseThresholdConfig('{"default":{"limit":100000}}');
    expect(cfg.default).toEqual({ limit: 100000, alert_at: 80000 });
  });
});

describe("resolveThreshold", () => {
  it("uses the account override, else the default", () => {
    const cfg = parseThresholdConfig('{"accounts":{"act_1":{"limit":30000,"alert_at":20000}}}');
    expect(resolveThreshold(cfg, "act_1")).toEqual({ limit: 30000, alert_at: 20000 });
    expect(resolveThreshold(cfg, "act_9")).toEqual({ limit: 50000, alert_at: 40000 });
  });

  it("puts the warning at 80% when an account sets only its limit", () => {
    const cfg = parseThresholdConfig('{"accounts":{"act_1":{"limit":30000}}}');
    expect(resolveThreshold(cfg, "act_1")).toEqual({ limit: 30000, alert_at: 24000 });
  });

  it("never lets the warning sit above the limit", () => {
    const cfg = parseThresholdConfig('{"accounts":{"act_1":{"limit":30000,"alert_at":45000}}}');
    expect(resolveThreshold(cfg, "act_1").alert_at).toBe(30000);
  });

  it("withAccountThreshold replaces one account and keeps the rest", () => {
    const cfg = withAccountThreshold(DEFAULT_THRESHOLD_CONFIG, "act_1", { limit: 60000, alert_at: 45000 });
    expect(cfg.accounts).toEqual({ act_1: { limit: 60000, alert_at: 45000 } });
    expect(DEFAULT_THRESHOLD_CONFIG.accounts).toEqual({});
  });
});

describe("thresholdStatus", () => {
  const setting = { limit: 50000, alert_at: 40000 };

  it("is quiet under the alert level", () => {
    const s = thresholdStatus(39999, setting);
    expect(s.stage).toBeNull();
    expect(s.pct).toBeCloseTo(79.998);
    expect(s.remaining).toBe(10001);
  });

  it("is approaching from ₱40,000 and reached from ₱50,000", () => {
    expect(thresholdStatus(40000, setting).stage).toBe("approaching");
    expect(thresholdStatus(49999.99, setting).stage).toBe("approaching");
    expect(thresholdStatus(50000, setting).stage).toBe("reached");
    expect(thresholdStatus(52000, setting).remaining).toBe(0);
  });
});

describe("advanceCycle", () => {
  it("starts at cycle 0 the first time an account is seen", () => {
    expect(advanceCycle(undefined, 12000)).toEqual({ balance: 12000, cycle: 0 });
  });

  it("keeps the cycle while the balance climbs or holds", () => {
    expect(advanceCycle({ balance: 12000, cycle: 2 }, 15000)).toEqual({ balance: 15000, cycle: 2 });
    expect(advanceCycle({ balance: 15000, cycle: 2 }, 15000)).toEqual({ balance: 15000, cycle: 2 });
  });

  it("starts a new cycle when the balance drops", () => {
    expect(advanceCycle({ balance: 49000, cycle: 2 }, 800)).toEqual({ balance: 800, cycle: 3 });
  });
});

describe("parseThresholdState", () => {
  it("reads good rows and drops junk", () => {
    expect(parseThresholdState(null)).toEqual({});
    expect(parseThresholdState("nope")).toEqual({});
    expect(
      parseThresholdState('{"act_1":{"balance":100,"cycle":4},"act_2":{"balance":"x"},"act_3":{"balance":5}}')
    ).toEqual({ act_1: { balance: 100, cycle: 4 }, act_3: { balance: 5, cycle: 0 } });
  });
});

describe("shouldAlert", () => {
  const setting = { limit: 50000, alert_at: 40000 };

  it("alerts the first time the balance crosses ₱40,000", () => {
    expect(shouldAlert(thresholdStatus(41000, setting), 0, null)).toBe(true);
  });

  it("does not alert below the level, even with no prior alert", () => {
    expect(shouldAlert(thresholdStatus(5565, setting), 0, null)).toBe(false);
  });

  it("stays silent as the balance keeps climbing in the same cycle", () => {
    const prior = { stage: "approaching" as const, cycle: 0 };
    expect(shouldAlert(thresholdStatus(44000, setting), 0, prior)).toBe(false);
  });

  it("alerts once more when the limit itself is reached", () => {
    const prior = { stage: "approaching" as const, cycle: 0 };
    expect(shouldAlert(thresholdStatus(50000, setting), 0, prior)).toBe(true);
    const reached = { stage: "reached" as const, cycle: 0 };
    expect(shouldAlert(thresholdStatus(51000, setting), 0, reached)).toBe(false);
  });

  it("alerts again in the next cycle, after the card was charged", () => {
    const prior = { stage: "reached" as const, cycle: 0 };
    expect(shouldAlert(thresholdStatus(40500, setting), 1, prior)).toBe(true);
  });

  it("still warns in the next cycle when the ₱50,000 alert was never sent", () => {
    // Spend jumped past ₱50,000 and Meta charged between two passes, so the
    // last alert on file is the previous cycle's warning. The balance climbs
    // back above where that warning fired: the new cycle must warn anyway.
    const prior = { stage: "approaching" as const, cycle: 0 };
    let seen = advanceCycle(undefined, 40200); // warning sent here, cycle 0
    seen = advanceCycle(seen, 2000); // charged between passes
    seen = advanceCycle(seen, 41500);
    expect(seen.cycle).toBe(1);
    expect(shouldAlert(thresholdStatus(41500, setting), seen.cycle, prior)).toBe(true);
  });
});

describe("describeThresholdAlert", () => {
  it("writes an URGENT title with the amounts, and names the stores and card", () => {
    const status = thresholdStatus(40120, { limit: 50000, alert_at: 40000 });
    const t = describeThresholdAlert({
      accountName: "TBM1 - NURTELLE",
      balance: 40120,
      status,
      card: "VISA *8005",
      stores: ["NURTELLE"],
    });
    expect(t.title).toBe("URGENT: TBM1 - NURTELLE is at ₱40,120 of its ₱50,000 billing limit");
    expect(t.body).toContain("₱9,880 away");
    expect(t.body).toContain("(NURTELLE)");
    expect(t.body).toContain("VISA *8005");
  });

  it("says the charge is happening now once the limit is hit", () => {
    const status = thresholdStatus(50300, { limit: 50000, alert_at: 40000 });
    const t = describeThresholdAlert({
      accountName: "ACC1",
      balance: 50300,
      status,
      card: null,
      stores: [],
    });
    expect(t.title).toMatch(/^URGENT: ACC1 hit its ₱50,000 billing limit/);
    expect(t.body).toContain("charging the card on file now");
  });
});

describe("describePaymentFailedAlert", () => {
  it("names the account, amount, stores and card, and says it repeats", () => {
    const t = describePaymentFailedAlert({
      accountName: "TBM1 - NURTELLE",
      balance: 31324.35,
      headline: "A payment failed, so Meta has stopped delivering every ad in this account.",
      action: "Pay the outstanding balance on Meta's Billing page.",
      card: "VISA *8005",
      stores: ["NURTELLE"],
    });
    expect(t.title).toBe("URGENT: TBM1 - NURTELLE payment failed — ₱31,324 unpaid");
    expect(t.body).toContain("stopped delivering every ad");
    expect(t.body).toContain("NURTELLE.");
    expect(t.body).toContain("VISA *8005");
    expect(t.body).toContain("repeats every 6 hours");
  });
});
