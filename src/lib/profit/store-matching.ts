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

export const KNOWN_STORES = ["I LOVE PATCHES", "CAPSULED", "HIBI", "SERINA"] as const;

export function isKnownStore(storeName: string | null | undefined): boolean {
  if (!storeName) return false;
  return (KNOWN_STORES as readonly string[]).includes(storeName);
}

/**
 * Normalize a J&T sender name to a standard store name.
 * Uses contains-based matching to handle variations like
 * "Ilovepatches", "ILOVEPATCHES", "I Love Patches", etc.
 */
export function matchSenderToStore(senderName: string): string {
  const upper = senderName.toUpperCase().trim().replace(/\s+/g, " ");

  // Check contains — order matters (specific first)
  if (upper.includes("ILOVEPATCHES") || upper.includes("I LOVE PATCHES") || upper.includes("I LOVE PATCH") || upper.includes("ILOVEPATCH"))
    return "I LOVE PATCHES";
  if (upper.includes("CAPSULED")) return "CAPSULED";
  if (upper.includes("HIBI")) return "HIBI";
  if (upper.includes("SERINA")) return "SERINA";

  return senderName.trim();
}
