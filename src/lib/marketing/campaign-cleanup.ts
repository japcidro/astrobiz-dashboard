// Which campaigns are safe for an admin to clear out of an ad account.
//
// The promote flow can leave a campaign behind: it creates the campaign and
// its first ad set before copying the ad, and a failed copy leaves both
// standing. Those orphans are harmless — a cloned ad set is always created
// PAUSED, and with no ad in it there is nothing to deliver — but they pile
// up in every campaign dropdown.
//
// Cleanup is destructive and irreversible for real campaigns, so it is
// gated on evidence rather than intent. A campaign qualifies only when it
// could not possibly be doing anything: no ads, no spend ever, every ad set
// paused, and not the campaign some store scales into. The server re-checks
// every one of these against Graph immediately before acting — this module
// is the single definition both the listing and the act agree on.

export interface CampaignCleanupFacts {
  id: string;
  name: string;
  effective_status: string;
  /** Ads anywhere under the campaign. Zero is the orphan signature. */
  ad_count: number;
  /** Ad sets under it, with the status that decides "could it run". */
  adset_statuses: string[];
  /** Lifetime spend in major units. */
  spend: number;
  /** Lifetime impressions — spend alone can round to 0. */
  impressions: number;
  /** True when a store scales into this campaign. */
  is_mapped: boolean;
}

export interface CleanupVerdict {
  eligible: boolean;
  /** Why not — in the order a person would want to hear them. */
  blockers: string[];
}

const ALREADY_GONE = new Set(["ARCHIVED", "DELETED"]);

export function campaignCleanupVerdict(
  facts: CampaignCleanupFacts
): CleanupVerdict {
  const blockers: string[] = [];

  if (ALREADY_GONE.has(facts.effective_status)) {
    blockers.push("already archived or deleted");
  }
  if (facts.is_mapped) {
    blockers.push("a store scales into this campaign");
  }
  if (facts.ad_count > 0) {
    blockers.push(
      `has ${facts.ad_count} ad${facts.ad_count === 1 ? "" : "s"} in it`
    );
  }
  if (facts.spend > 0) {
    blockers.push(`has spent ${facts.spend}`);
  }
  if (facts.impressions > 0) {
    blockers.push(
      `has ${facts.impressions} lifetime impression${facts.impressions === 1 ? "" : "s"}`
    );
  }
  const live = facts.adset_statuses.filter(
    (s) => !s.includes("PAUSED") && !ALREADY_GONE.has(s)
  );
  if (live.length > 0) {
    blockers.push(
      `${live.length} ad set${live.length === 1 ? " is" : "s are"} not paused`
    );
  }

  return { eligible: blockers.length === 0, blockers };
}
