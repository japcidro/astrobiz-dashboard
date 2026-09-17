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

// ---------------------------------------------------------------------------
// Which store the promote modals open on.
//
// The store picker's real job is to name an ad account: Meta's /copies cannot
// cross ad accounts, so the source ad's own account already decides it. When
// that account maps to exactly one store, nobody should have to pick anything
// — and until they do, the entire campaign/ad set half of the modal is
// hidden behind the gate.
//
// Matching the store name inside the campaign name was the only derivation
// there used to be, and it fails for every campaign named after a product
// instead of a store ("NVP-082526LIN1" contains no store name), which is most
// of them.
// ---------------------------------------------------------------------------

export interface StoreAccountRef {
  store_name: string;
  account_id: string;
}

function normalizeAccountId(v: string | null | undefined): string {
  return (v ?? "").toString().replace(/^act_/, "").trim();
}

function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The store whose scaling campaign lives in the same ad account as the ads
 * being promoted. Null when the ads span several accounts (no single run
 * could copy them anyway) or when the account maps to more than one store.
 */
export function deriveStoreFromAccount(
  accountIds: Array<string | null | undefined>,
  configs: StoreAccountRef[]
): string | null {
  const accounts = new Set(
    accountIds.map(normalizeAccountId).filter((a) => a.length > 0)
  );
  if (accounts.size !== 1) return null;
  const account = [...accounts][0];

  const matches = new Set(
    configs
      .filter((c) => normalizeAccountId(c.account_id) === account)
      .map((c) => c.store_name)
  );
  return matches.size === 1 ? [...matches][0] : null;
}

/** Longest store name appearing inside the campaign name, if any. */
export function deriveStoreFromCampaign(
  campaign: string | null | undefined,
  stores: string[]
): string | null {
  const nc = normalizeName(campaign ?? "");
  if (!nc) return null;
  let best: { name: string; len: number } | null = null;
  for (const s of stores) {
    const k = normalizeName(s);
    if (k && nc.includes(k) && (!best || k.length > best.len)) {
      best = { name: s, len: k.length };
    }
  }
  return best?.name ?? null;
}

/**
 * The store to open on: the ad account decides it when it can, the campaign
 * name is the fallback, and an explicit suggestion from the caller wins over
 * both. Null means the user genuinely has to choose.
 */
export function resolveStore(opts: {
  suggested?: string | null;
  accountIds?: Array<string | null | undefined>;
  campaignName?: string | null;
  configs: StoreAccountRef[];
}): string | null {
  const stores = opts.configs.map((c) => c.store_name);
  const known = (s: string | null) =>
    s && stores.includes(s) ? s : null;

  return (
    known(opts.suggested ?? null) ??
    known(deriveStoreFromAccount(opts.accountIds ?? [], opts.configs)) ??
    known(deriveStoreFromCampaign(opts.campaignName, stores))
  );
}
