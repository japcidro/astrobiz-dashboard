import { describe, it, expect } from "vitest";
import {
  campaignCleanupVerdict,
  type CampaignCleanupFacts,
} from "../campaign-cleanup";

// The orphan a half-failed promote leaves: campaign and ad set created,
// ad copy failed, nothing in it, nothing ever spent.
const orphan: CampaignCleanupFacts = {
  id: "120111",
  name: "NURTELLE-SCALING",
  effective_status: "ACTIVE",
  ad_count: 0,
  adset_statuses: ["PAUSED"],
  spend: 0,
  impressions: 0,
  is_mapped: false,
};

describe("campaignCleanupVerdict", () => {
  it("clears the orphan a failed promote leaves behind", () => {
    expect(campaignCleanupVerdict(orphan)).toEqual({
      eligible: true,
      blockers: [],
    });
  });

  it("clears a campaign with no ad sets at all", () => {
    expect(
      campaignCleanupVerdict({ ...orphan, adset_statuses: [] }).eligible
    ).toBe(true);
  });

  // Every one of these is a campaign somebody could be relying on.
  it("refuses a campaign holding ads", () => {
    const v = campaignCleanupVerdict({ ...orphan, ad_count: 3 });
    expect(v.eligible).toBe(false);
    expect(v.blockers[0]).toMatch(/has 3 ads/);
  });

  it("refuses a campaign that ever spent", () => {
    expect(campaignCleanupVerdict({ ...orphan, spend: 0.5 }).eligible).toBe(
      false
    );
  });

  // Spend rounds; impressions don't. A campaign that delivered is history
  // worth keeping even if it somehow cost nothing.
  it("refuses a campaign that ever delivered, even for free", () => {
    const v = campaignCleanupVerdict({ ...orphan, impressions: 12 });
    expect(v.eligible).toBe(false);
    expect(v.blockers[0]).toMatch(/12 lifetime impressions/);
  });

  it("refuses a campaign with a live ad set", () => {
    const v = campaignCleanupVerdict({
      ...orphan,
      adset_statuses: ["PAUSED", "ACTIVE"],
    });
    expect(v.eligible).toBe(false);
    expect(v.blockers[0]).toMatch(/1 ad set is not paused/);
  });

  // CAMPAIGN_PAUSED / ADSET_PAUSED are paused states, not live ones.
  it("counts every flavour of paused as paused", () => {
    expect(
      campaignCleanupVerdict({
        ...orphan,
        adset_statuses: ["CAMPAIGN_PAUSED", "ADSET_PAUSED", "PAUSED"],
      }).eligible
    ).toBe(true);
  });

  it("refuses the campaign a store scales into", () => {
    const v = campaignCleanupVerdict({ ...orphan, is_mapped: true });
    expect(v.eligible).toBe(false);
    expect(v.blockers[0]).toMatch(/scales into/);
  });

  it("refuses one that is already gone", () => {
    expect(
      campaignCleanupVerdict({ ...orphan, effective_status: "ARCHIVED" })
        .eligible
    ).toBe(false);
  });

  it("lists every reason, not just the first", () => {
    const v = campaignCleanupVerdict({
      ...orphan,
      ad_count: 2,
      spend: 100,
      is_mapped: true,
    });
    expect(v.blockers).toHaveLength(3);
  });
});
