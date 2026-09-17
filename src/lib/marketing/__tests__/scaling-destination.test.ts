import { describe, it, expect } from "vitest";
import {
  EMPTY_NEW_CAMPAIGN,
  campaignBlockReason,
  campaignPayload,
  defaultObjective,
  destinationCampaignId,
  parseChoice,
  serializeChoice,
  type CampaignChoice,
  type ConfiguredScalingCampaign,
} from "../scaling-destination";

const configured: ConfiguredScalingCampaign = {
  id: "120111",
  name: "CBO-CAPSULED",
  objective: "OUTCOME_SALES",
  special_ad_categories: [],
};

const draft = {
  ...EMPTY_NEW_CAMPAIGN,
  name: "CBO — SEPT WINNERS",
  objective: "OUTCOME_SALES",
};

describe("choice round-trip", () => {
  it("survives the <select> value it is stored as", () => {
    const cases: CampaignChoice[] = [
      { kind: "configured" },
      { kind: "new" },
      { kind: "existing", id: "120999" },
    ];
    for (const c of cases) {
      expect(parseChoice(serializeChoice(c))).toEqual(c);
    }
  });

  it("falls back to the mapped campaign on anything unrecognised", () => {
    expect(parseChoice("")).toEqual({ kind: "configured" });
    expect(parseChoice("garbage")).toEqual({ kind: "configured" });
  });
});

describe("destinationCampaignId", () => {
  it("is the mapped campaign by default", () => {
    expect(destinationCampaignId({ kind: "configured" }, configured)).toBe(
      "120111"
    );
  });

  it("is the chosen campaign when one is chosen", () => {
    expect(
      destinationCampaignId({ kind: "existing", id: "120999" }, configured)
    ).toBe("120999");
  });

  // A campaign that does not exist yet has no ad sets to drop into — the
  // modals key the "existing ad set" options off exactly this null.
  it("is null for a campaign that has not been created yet", () => {
    expect(destinationCampaignId({ kind: "new" }, configured)).toBeNull();
  });
});

describe("campaignBlockReason", () => {
  it("never blocks a campaign that already exists", () => {
    expect(campaignBlockReason({ kind: "configured" }, EMPTY_NEW_CAMPAIGN))
      .toBeNull();
    expect(
      campaignBlockReason({ kind: "existing", id: "1" }, EMPTY_NEW_CAMPAIGN)
    ).toBeNull();
  });

  it("wants a name, then an objective", () => {
    expect(campaignBlockReason({ kind: "new" }, EMPTY_NEW_CAMPAIGN)).toMatch(
      /campaign name/i
    );
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, objective: "" })
    ).toMatch(/objective/i);
    expect(campaignBlockReason({ kind: "new" }, draft)).toBeNull();
  });

  it("accepts a blank budget but not a nonsense one", () => {
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, daily_budget: "" })
    ).toBeNull();
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, daily_budget: "2000" })
    ).toBeNull();
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, daily_budget: "0" })
    ).toMatch(/above 0/);
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, daily_budget: "-5" })
    ).toMatch(/above 0/);
    expect(
      campaignBlockReason({ kind: "new" }, { ...draft, daily_budget: "abc" })
    ).toMatch(/above 0/);
  });
});

describe("campaignPayload", () => {
  it("says nothing for the mapped campaign, so the server's default stands", () => {
    expect(campaignPayload({ kind: "configured" }, EMPTY_NEW_CAMPAIGN)).toEqual(
      {}
    );
  });

  it("names an existing campaign by id", () => {
    expect(
      campaignPayload({ kind: "existing", id: "120999" }, EMPTY_NEW_CAMPAIGN)
    ).toEqual({ target_campaign_id: "120999" });
  });

  it("asks for a new campaign, budget omitted when blank", () => {
    expect(campaignPayload({ kind: "new" }, draft)).toEqual({
      new_campaign: {
        name: "CBO — SEPT WINNERS",
        objective: "OUTCOME_SALES",
        daily_budget: null,
      },
    });
  });

  it("sends the budget in major units, as typed", () => {
    expect(
      campaignPayload({ kind: "new" }, { ...draft, daily_budget: " 2000 " })
    ).toEqual({
      new_campaign: {
        name: "CBO — SEPT WINNERS",
        objective: "OUTCOME_SALES",
        daily_budget: 2000,
      },
    });
  });

  // The whole point of threading the created id back through a bulk run:
  // ad #2 onwards must join the campaign ad #1 made, not make their own.
  it("targets the campaign the first ad of a bulk run created", () => {
    expect(campaignPayload({ kind: "new" }, draft, "120777")).toEqual({
      target_campaign_id: "120777",
    });
  });
});

describe("defaultObjective", () => {
  it("copies the mapped campaign's objective", () => {
    expect(defaultObjective(configured)).toBe("OUTCOME_SALES");
  });

  // Meta still reports legacy objectives (CONVERSIONS, LINK_CLICKS) on old
  // campaigns, and rejects them on create. Never pre-fill one.
  it("ignores an objective a new campaign could not be created with", () => {
    expect(
      defaultObjective({ ...configured, objective: "CONVERSIONS" })
    ).toBe("OUTCOME_SALES");
    expect(defaultObjective({ ...configured, objective: null })).toBe(
      "OUTCOME_SALES"
    );
    expect(defaultObjective(null)).toBe("OUTCOME_SALES");
  });
});
