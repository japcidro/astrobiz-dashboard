import { describe, it, expect } from "vitest";
import {
  EMPTY_NEW_CAMPAIGN,
  campaignBlockReason,
  campaignPayload,
  defaultObjective,
  destinationCampaignId,
  initialChoice,
  parseChoice,
  resolveStore,
  serializeChoice,
  singleAccountId,
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
      { kind: "unset" },
      { kind: "configured" },
      { kind: "new" },
      { kind: "existing", id: "120999" },
    ];
    for (const c of cases) {
      expect(parseChoice(serializeChoice(c))).toEqual(c);
    }
  });

  // Unrecognised must land on "unset", never on "configured": an ad
  // account with no mapped scaling campaign has no configured campaign to
  // fall back to, and silently claiming one would submit against a
  // campaign that doesn't exist.
  it("falls back to unset on anything unrecognised", () => {
    expect(parseChoice("")).toEqual({ kind: "unset" });
    expect(parseChoice("garbage")).toEqual({ kind: "unset" });
  });
});

describe("initialChoice", () => {
  it("opens on the mapped campaign when there is one", () => {
    expect(initialChoice(configured)).toEqual({ kind: "configured" });
  });

  // The Nurtelle case: a store new enough that its first scaling campaign
  // does not exist yet. Nothing to default to, so the user must choose.
  it("opens on nothing when the ad account has no mapped campaign", () => {
    expect(initialChoice(null)).toEqual({ kind: "unset" });
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
  it("blocks until an unmapped account's campaign is chosen", () => {
    expect(campaignBlockReason({ kind: "unset" }, EMPTY_NEW_CAMPAIGN)).toMatch(
      /pick a target campaign/i
    );
  });

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

describe("resolveStore", () => {
  const configs = [
    { store_name: "CAPSULED", account_id: "act_111" },
    { store_name: "FOLIQ", account_id: "act_222" },
    { store_name: "I Love Patches", account_id: "act_333" },
  ];

  // The case that made the whole campaign step unreachable: ads named after
  // the product, never the store, so name matching found nothing and the
  // modal opened on "— Pick store —" with everything else hidden behind it.
  it("names the store from the ad account when the campaign name can't", () => {
    expect(
      resolveStore({
        accountIds: ["act_222", "act_222"],
        campaignName: "NVP-082526LIN1",
        configs,
      })
    ).toBe("FOLIQ");
  });

  it("does not care about the act_ prefix on either side", () => {
    expect(resolveStore({ accountIds: ["111"], configs })).toBe("CAPSULED");
    expect(
      resolveStore({
        accountIds: ["act_444"],
        configs: [{ store_name: "CAPSULED", account_id: "444" }],
      })
    ).toBe("CAPSULED");
  });

  // Meta's /copies cannot cross ad accounts, so a mixed selection has no
  // single answer — better to ask than to guess one and fail per ad.
  it("declines to guess when the ads span several ad accounts", () => {
    expect(
      resolveStore({ accountIds: ["act_111", "act_222"], configs })
    ).toBeNull();
  });

  it("declines to guess when one account maps to two stores", () => {
    expect(
      resolveStore({
        accountIds: ["act_111"],
        configs: [
          { store_name: "CAPSULED", account_id: "act_111" },
          { store_name: "CAPSULED PH", account_id: "act_111" },
        ],
      })
    ).toBeNull();
  });

  it("still falls back to the store name inside the campaign name", () => {
    expect(
      resolveStore({
        accountIds: [null, undefined],
        campaignName: "CBO-CAPSULED — SEPT",
        configs,
      })
    ).toBe("CAPSULED");
  });

  it("prefers the caller's own suggestion over both", () => {
    expect(
      resolveStore({
        suggested: "FOLIQ",
        accountIds: ["act_111"],
        campaignName: "CBO-CAPSULED",
        configs,
      })
    ).toBe("FOLIQ");
  });

  it("ignores a suggestion no store mapping knows about", () => {
    expect(
      resolveStore({
        suggested: "DELETED STORE",
        accountIds: ["act_111"],
        configs,
      })
    ).toBe("CAPSULED");
  });

  it("is null when nothing identifies a store", () => {
    expect(
      resolveStore({ accountIds: ["act_999"], campaignName: "NVP-1", configs })
    ).toBeNull();
  });
});

describe("singleAccountId", () => {
  it("names the one account a set of ads shares", () => {
    expect(singleAccountId(["act_111", "act_111", "111"])).toBe("act_111");
  });

  // Meta's /copies cannot leave an ad account, so a mixed set has no single
  // destination and the modal has to ask instead of guessing.
  it("is null when the ads span several accounts", () => {
    expect(singleAccountId(["act_111", "act_222"])).toBeNull();
  });

  it("is null when the ads carry no account at all", () => {
    expect(singleAccountId([null, undefined, ""])).toBeNull();
  });
});
