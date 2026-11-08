import { matchAdToStore } from "@/lib/profit/store-matching";

/**
 * Ad spend reaches a store's P&L by the names of the campaign and ad set
 * (matchAdToStore), never by the ad account: several brands share one
 * account, and the account's own name may carry none of them. This is the
 * line the wizards show when the campaign an ad is going into will not
 * count for the store it was made for; null when it will, or when nothing
 * is chosen yet.
 */
export function campaignStoreWarning(
  campaignName: string | null | undefined,
  storeName: string | null | undefined
): string | null {
  const store = (storeName ?? "").trim();
  const name = (campaignName ?? "").trim();
  if (!store || !name) return null;
  // The store's own keyword, in the matcher's canonical form ("I Love
  // Patches" → "I LOVE PATCHES"). A store the matcher has no keyword for
  // cannot be checked against.
  const want = matchAdToStore(store, "");
  if (!want) return null;
  const got = matchAdToStore(name, "");
  if (got === want) return null;
  return got
    ? `"${name}" reads as a ${got} campaign, so its spend will count for ${got}, not ${store}. Put ${store} in the name.`
    : `Put ${store} in the campaign name: spend reaches a store's P&L by the campaign name, and this one names no store.`;
}
