/**
 * Match a Meta Ads campaign/adset name to a store.
 * Checks both campaign and adset names for store keywords.
 *
 * Only ACTIVE stores are matched — a revived campaign for a retired brand
 * lands in UNATTRIBUTED rather than creating ad spend with no revenue behind it.
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
  if (text.includes("FOLIQ")) return "FOLIQ";

  return ""; // unattributed
}

/**
 * Stores we currently ship for. Drives every store picker in the UI.
 */
export const ACTIVE_STORES = ["I LOVE PATCHES", "CAPSULED", "FOLIQ"] as const;

/**
 * Stores we no longer ship for. Kept only so their historical parcels
 * aren't flagged as unknown senders — never offered as a choice.
 */
export const RETIRED_STORES = ["HIBI", "SERINA"] as const;

/**
 * Every store name the system recognizes, active or retired.
 */
export const KNOWN_STORES = [...ACTIVE_STORES, ...RETIRED_STORES] as const;

export function isKnownStore(storeName: string | null | undefined): boolean {
  if (!storeName) return false;
  return (KNOWN_STORES as readonly string[]).includes(storeName);
}

/**
 * Normalize a J&T sender name to a standard store name.
 * Uses contains-based matching to handle variations like
 * "Ilovepatches", "ILOVEPATCHES", "I Love Patches", etc.
 *
 * Retired brands stay here so re-uploading an old J&T export still
 * normalizes the same way it did originally.
 */
export function matchSenderToStore(senderName: string): string {
  const upper = senderName.toUpperCase().trim().replace(/\s+/g, " ");

  // Check contains — order matters (specific first)
  if (upper.includes("ILOVEPATCHES") || upper.includes("I LOVE PATCHES") || upper.includes("I LOVE PATCH") || upper.includes("ILOVEPATCH"))
    return "I LOVE PATCHES";
  if (upper.includes("CAPSULED")) return "CAPSULED";
  if (upper.includes("FOLIQ")) return "FOLIQ";
  if (upper.includes("HIBI")) return "HIBI";
  if (upper.includes("SERINA")) return "SERINA";

  return senderName.trim();
}
