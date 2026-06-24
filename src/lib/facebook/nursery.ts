// Fix Rejections is scoped to "nursery" (testing) campaigns only — the cat
// method is meant for nursery ads, not scaling/winning ones. All of their
// nursery campaigns carry "NURSERY"/"Nursery" in the campaign name
// (e.g. ILOVEPATCHES-NURSERY, LUM-NURSERY-1.1, HIBI-NURSERY). Both the
// rejected-ads listing and the fix route gate on this so an ad outside a
// nursery campaign can never be fixed, even if called directly.
//
// If the naming convention ever changes, update this one matcher.
export const NURSERY_MATCH = /nurser/i;

export function isNurseryCampaign(campaignName: string | null | undefined): boolean {
  return NURSERY_MATCH.test(campaignName ?? "");
}
