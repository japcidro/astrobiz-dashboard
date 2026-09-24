import { describe, it, expect } from "vitest";
import {
  describeAccountStatus,
  minorToMajor,
  metaBillingUrl,
  metaPaymentSettingsUrl,
  adsManagerUrl,
  storesForAccount,
} from "../billing";
import { matchAdToStore } from "@/lib/profit/store-matching";

describe("describeAccountStatus", () => {
  it("treats ACTIVE as healthy with nothing to do", () => {
    const s = describeAccountStatus(1, 0);
    expect(s.label).toBe("ACTIVE");
    expect(s.tone).toBe("ok");
    expect(s.needsPayment).toBe(false);
    expect(s.action).toBeNull();
  });

  it("flags UNSETTLED as a payment problem that stops delivery", () => {
    const s = describeAccountStatus(3, 0);
    expect(s.label).toBe("UNSETTLED");
    expect(s.tone).toBe("bad");
    expect(s.needsPayment).toBe(true);
    expect(s.headline).toMatch(/stopped delivering/);
  });

  it("flags grace period and pending settlement as pay-soon warnings", () => {
    expect(describeAccountStatus(9, 0)).toMatchObject({
      label: "IN_GRACE_PERIOD",
      tone: "warn",
      needsPayment: true,
    });
    expect(describeAccountStatus(8, 0)).toMatchObject({
      label: "PENDING_SETTLEMENT",
      tone: "warn",
      needsPayment: true,
    });
  });

  it("only asks for payment on a DISABLED account when the reason is payment risk", () => {
    expect(describeAccountStatus(2, 3).needsPayment).toBe(true);
    expect(describeAccountStatus(2, 1).needsPayment).toBe(false);
    expect(describeAccountStatus(2, 1).headline).toMatch(/integrity policy/);
  });

  it("does not throw on a status it has never seen", () => {
    const s = describeAccountStatus(999, 0);
    expect(s.label).toBe("UNKNOWN");
    expect(s.tone).toBe("muted");
    expect(s.needsPayment).toBe(false);
  });
});

describe("minorToMajor", () => {
  it("converts Meta's centavo strings to pesos", () => {
    expect(minorToMajor("3132435", "PHP")).toBe(31324.35);
    expect(minorToMajor("0", "PHP")).toBe(0);
  });

  it("leaves zero-decimal currencies whole", () => {
    expect(minorToMajor("1500", "JPY")).toBe(1500);
  });

  it("returns 0 for missing or malformed values", () => {
    expect(minorToMajor(null)).toBe(0);
    expect(minorToMajor(undefined)).toBe(0);
    expect(minorToMajor("")).toBe(0);
    expect(minorToMajor("abc")).toBe(0);
  });
});

describe("Meta links", () => {
  it("builds the billing page link without the act_ prefix and with the business", () => {
    expect(metaBillingUrl("act_888347852462027", "3302510200076341")).toBe(
      "https://business.facebook.com/billing_hub/accounts/details/?asset_id=888347852462027&business_id=3302510200076341"
    );
  });

  it("omits business_id when unknown", () => {
    expect(metaBillingUrl("act_1", null)).toBe(
      "https://business.facebook.com/billing_hub/accounts/details/?asset_id=1"
    );
    expect(metaPaymentSettingsUrl("act_1", undefined)).toBe(
      "https://business.facebook.com/billing_hub/payment_settings/?asset_id=1"
    );
  });

  it("links Ads Manager by numeric account id", () => {
    expect(adsManagerUrl("act_42")).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=42"
    );
  });
});

describe("storesForAccount", () => {
  const rows = [
    { account_id: "act_A", campaign: "FOLIQ-TEST-1", adset: "x", spend: 100 },
    { account_id: "act_A", campaign: "FOLIQ-SCALE", adset: "y", spend: 250 },
    { account_id: "act_A", campaign: "CBO-3", adset: "z", spend: 0 }, // unattributed
    { account_id: "act_B", campaign: "ILP-NURSERY", adset: "q", spend: 900 },
    { account_id: "act_B", campaign: "CAPSULED-OLD", adset: "r", spend: 0 },
  ];

  it("lists only the stores whose campaigns run in that account, biggest spender first", () => {
    const a = storesForAccount(rows, "act_A", "TBM1 - ACC A", matchAdToStore);
    expect(a).toEqual([
      { store: "FOLIQ", spend: 350, ads: 2, source: "campaigns" },
    ]);

    const b = storesForAccount(rows, "act_B", "TBM1 - ACC B", matchAdToStore);
    expect(b.map((s) => s.store)).toEqual(["I LOVE PATCHES", "CAPSULED"]);
  });

  it("adds a store whose Create Ad defaults point here even with no ads in the window", () => {
    const b = storesForAccount(rows, "act_B", "TBM1 - ACC B", matchAdToStore, [
      "CAPSULED",
      "NURTELLE",
    ]);
    expect(b.find((s) => s.store === "CAPSULED")?.source).toBe("campaigns");
    expect(b.find((s) => s.store === "NURTELLE")).toEqual({
      store: "NURTELLE",
      spend: 0,
      ads: 0,
      source: "defaults",
    });
  });

  it("falls back to the account name when campaigns do not name a brand", () => {
    const c = storesForAccount(
      [{ account_id: "act_C", campaign: "CBO-1", adset: "AUTISTIC", spend: 50 }],
      "act_C",
      "TBM1 - NURTELLE",
      matchAdToStore
    );
    expect(c).toEqual([{ store: "NURTELLE", spend: 50, ads: 1, source: "campaigns" }]);
  });
});
