/**
 * Match a Meta Ads campaign/adset name to a store.
 * Checks both campaign and adset names for store keywords.
 */
export function matchAdToStore(
  campaignName: string,
  adsetName: string
): string {
  const text = (campaignName + " " + adsetName).toUpperCase();

  // Check more specific patterns first
  if (
    text.includes("ILOVEPATCHES") ||
    text.includes("I LOVE PATCHES") ||
    text.includes("ILP")
  )
    return "I LOVE PATCHES";
  if (text.includes("CAPSULED")) return "CAPSULED";
  if (text.includes("HIBI")) return "HIBI";
  if (text.includes("SERINA")) return "SERINA";

  return ""; // unattributed
}

/**
 * Normalize a J&T sender name to a standard store name.
 */
export function matchSenderToStore(senderName: string): string {
  const SENDER_MAP: Record<string, string> = {
    ILOVEPATCHES: "I LOVE PATCHES",
    "I LOVE PATCH": "I LOVE PATCHES",
    ILOVEPATCH: "I LOVE PATCHES",
    "I LOVE PATCHES": "I LOVE PATCHES",
    CAPSULED: "CAPSULED",
    HIBI: "HIBI",
    SERINA: "SERINA",
  };

  const upper = senderName.toUpperCase().trim();
  return SENDER_MAP[upper] || senderName.trim();
}
