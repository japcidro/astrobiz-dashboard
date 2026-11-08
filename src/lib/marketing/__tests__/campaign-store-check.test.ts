import { describe, expect, it } from "vitest";
import { campaignStoreWarning } from "../campaign-store-check";

describe("campaignStoreWarning", () => {
  it("is quiet when the campaign names the store", () => {
    expect(campaignStoreWarning("YUMO-NURSERY", "YUMO")).toBeNull();
    expect(campaignStoreWarning("ILP-TEST 3", "I Love Patches")).toBeNull();
    expect(campaignStoreWarning("foliq-scaling", "FOLIQ")).toBeNull();
  });

  it("warns when the campaign names no store", () => {
    expect(campaignStoreWarning("NURSERY 2", "YUMO")).toMatch(/Put YUMO in the campaign name/);
  });

  it("warns when the campaign belongs to another store in the same account", () => {
    const w = campaignStoreWarning("FOLIQ-NURSERY 2", "YUMO");
    expect(w).toMatch(/reads as a FOLIQ campaign/);
    expect(w).toMatch(/not YUMO/);
  });

  it("has nothing to say before a store and a campaign are both chosen, or for a store it cannot match", () => {
    expect(campaignStoreWarning("", "YUMO")).toBeNull();
    expect(campaignStoreWarning("YUMO-NURSERY", null)).toBeNull();
    expect(campaignStoreWarning("CBO-HIBI", "HIBI")).toBeNull();
  });
});
