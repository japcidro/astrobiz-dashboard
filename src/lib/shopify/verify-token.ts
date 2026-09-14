import { normalizeStoreUrl } from "./store-url";

// Confirms an Admin API access token actually works against the store before
// it is saved, so a bad paste surfaces here instead of as an empty orders
// table hours later.
export async function verifyShopifyToken(
  storeUrl: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = normalizeStoreUrl(storeUrl);
  if (!host) return { ok: false, error: "Store URL is empty" };

  try {
    const res = await fetch(`https://${host}/admin/api/2024-01/shop.json`, {
      headers: { "X-Shopify-Access-Token": token },
      cache: "no-store",
    });

    if (res.ok) return { ok: true };

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error:
          "Shopify rejected that access token. Check you copied the Admin API access token (starts with shpat_) from the right store, and that the app is installed.",
      };
    }

    if (res.status === 404) {
      return {
        ok: false,
        error: `No Shopify store answered at ${host}. Check the store URL.`,
      };
    }

    return {
      ok: false,
      error: `Shopify returned ${res.status} when testing the token.`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reach Shopify",
    };
  }
}
