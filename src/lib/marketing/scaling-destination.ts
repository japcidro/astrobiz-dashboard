// Where a promoted ad lands: the campaign half of the decision.
//
// Before this existed, "promote to scaling" had exactly one destination —
// the campaign mapped to the store in Admin → Settings — and the only
// choice on offer was which ad set inside it. These types and helpers add
// the two steps above that (another campaign in the same ad account, or a
// campaign created on submit) while keeping the mapped campaign as the
// default, so the common path is unchanged.
//
// Pure translation between what the modals hold in state and what
// /api/marketing/scaling/promote expects. No React, no fetch.

export interface ScalingCampaignRef {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string | null;
}

export interface ConfiguredScalingCampaign {
  id: string;
  name: string;
  objective: string | null;
  special_ad_categories: string[];
}

// "configured" is the store's mapped scaling campaign — kept as its own
// kind rather than an id so the default survives a slow or failed campaign
// list: the mapping itself comes from /scaling/config, separately.
export type CampaignChoice =
  | { kind: "configured" }
  | { kind: "existing"; id: string }
  | { kind: "new" };

export interface NewCampaignDraft {
  name: string;
  objective: string;
  // Major units, as typed. Blank = no campaign budget optimisation, which
  // leaves the cloned ad set carrying its own budget.
  daily_budget: string;
}

export const EMPTY_NEW_CAMPAIGN: NewCampaignDraft = {
  name: "",
  objective: "",
  daily_budget: "",
};

export const CAMPAIGN_OBJECTIVES: Array<{ value: string; label: string }> = [
  { value: "OUTCOME_SALES", label: "Sales" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_TRAFFIC", label: "Traffic" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engagement" },
  { value: "OUTCOME_AWARENESS", label: "Awareness" },
  { value: "OUTCOME_APP_PROMOTION", label: "App promotion" },
];

export function defaultObjective(
  c: ConfiguredScalingCampaign | null
): string {
  const o = c?.objective ?? "";
  return CAMPAIGN_OBJECTIVES.some((x) => x.value === o) ? o : "OUTCOME_SALES";
}

export function serializeChoice(c: CampaignChoice): string {
  if (c.kind === "configured") return "configured";
  if (c.kind === "new") return "new";
  return `existing:${c.id}`;
}

export function parseChoice(v: string): CampaignChoice {
  if (v === "new") return { kind: "new" };
  if (v.startsWith("existing:")) {
    return { kind: "existing", id: v.slice("existing:".length) };
  }
  return { kind: "configured" };
}

/** The campaign the ads end up in — null while it doesn't exist yet. */
export function destinationCampaignId(
  choice: CampaignChoice,
  configured: ConfiguredScalingCampaign | null
): string | null {
  if (choice.kind === "new") return null;
  if (choice.kind === "existing") return choice.id;
  return configured?.id ?? null;
}

/** Plain-language reason the new-campaign form isn't finished, or null. */
export function campaignBlockReason(
  choice: CampaignChoice,
  draft: NewCampaignDraft
): string | null {
  if (choice.kind !== "new") return null;
  if (draft.name.trim().length < 3) {
    return "Type a campaign name (min 3 characters).";
  }
  if (!draft.objective) return "Pick an objective for the new campaign.";
  if (draft.daily_budget.trim()) {
    const n = Number(draft.daily_budget);
    if (!Number.isFinite(n) || n <= 0) {
      return "Campaign daily budget must be a number above 0.";
    }
  }
  return null;
}

/**
 * The campaign half of a /scaling/promote body. Empty object for the
 * configured campaign, which is what the endpoint falls back to.
 *
 * `createdCampaignId` is how a bulk run stays honest: once the first ad has
 * created the campaign, every later ad targets it by id instead of asking
 * for another one — otherwise a 12-ad run ends as 12 identically-named
 * campaigns.
 */
export function campaignPayload(
  choice: CampaignChoice,
  draft: NewCampaignDraft,
  createdCampaignId?: string | null
): Record<string, unknown> {
  if (choice.kind === "new" && createdCampaignId) {
    return { target_campaign_id: createdCampaignId };
  }
  if (choice.kind === "new") {
    const budget = draft.daily_budget.trim();
    return {
      new_campaign: {
        name: draft.name.trim(),
        objective: draft.objective,
        daily_budget: budget ? Number(budget) : null,
      },
    };
  }
  if (choice.kind === "existing") {
    return { target_campaign_id: choice.id };
  }
  return {};
}
