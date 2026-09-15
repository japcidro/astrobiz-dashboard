/**
 * The store keywords, checked against one blob of text. Order matters —
 * more specific patterns first.
 */
function matchStoreKeyword(text: string): string {
  const upper = text.toUpperCase();

  if (
    upper.includes("ILOVEPATCHES") ||
    upper.includes("I LOVE PATCHES") ||
    upper.includes("ILP")
  )
    return "I LOVE PATCHES";
  if (upper.includes("CAPSULED")) return "CAPSULED";
  if (upper.includes("FOLIQ")) return "FOLIQ";
  if (upper.includes("NURTELLE")) return "NURTELLE";

  return "";
}

/**
 * Match a Meta Ads campaign/adset to a store.
 *
 * The campaign and adset names are checked first, because they name the brand
 * being advertised. `accountName` is a fallback for accounts dedicated to one
 * store, where the brand is in the ad account's name and the campaigns inside
 * it are named things like "CBO-TEST-3" — without it that spend lands in
 * UNATTRIBUTED and the store's CPP reads ₱0.00 while it is really spending.
 * Campaign-level naming still wins, so a correctly named campaign in a
 * mis-named account is attributed to the brand it actually advertises.
 *
 * Only ACTIVE stores are matched — a revived campaign for a retired brand
 * lands in UNATTRIBUTED rather than creating ad spend with no revenue behind it.
 */
export function matchAdToStore(
  campaignName: string,
  adsetName: string,
  accountName: string = ""
): string {
  const fromCampaign = matchStoreKeyword(`${campaignName} ${adsetName}`);
  if (fromCampaign) return fromCampaign;

  return matchStoreKeyword(accountName);
}

/**
 * Stores we currently ship for. Drives every store picker in the UI.
 */
export const ACTIVE_STORES = ["I LOVE PATCHES", "CAPSULED", "FOLIQ", "NURTELLE"] as const;

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
 * J&T redacts the sender name in some exports, leaving the first letters and
 * asterisks: "I******", "C******". Started appearing in files from May 2026.
 */
const MASKED_SENDER_RE = /^([^*]*)\*+$/;

export function isMaskedSenderName(senderName: string): boolean {
  return MASKED_SENDER_RE.test(senderName.trim());
}

/**
 * Recover the store behind a redacted sender name from the letters J&T left
 * behind. Resolves only when exactly one known store shares that prefix —
 * a tie means we genuinely can't tell, and guessing would silently file
 * parcels under the wrong store's RTS rate.
 */
function resolveMaskedSender(upperName: string): string {
  const match = upperName.match(MASKED_SENDER_RE);
  if (!match) return "";
  const prefix = match[1].trim();
  if (!prefix) return ""; // "******" carries no signal at all

  const candidates = (KNOWN_STORES as readonly string[]).filter((store) =>
    store.startsWith(prefix)
  );
  return candidates.length === 1 ? candidates[0] : "";
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
  if (upper.includes("NURTELLE")) return "NURTELLE";
  if (upper.includes("HIBI")) return "HIBI";
  if (upper.includes("SERINA")) return "SERINA";

  // Redacted by J&T — recover it from the surviving prefix. Returns "" when
  // ambiguous so the caller can fall back to the Shopify order link.
  if (isMaskedSenderName(upper)) return resolveMaskedSender(upper);

  return senderName.trim();
}
