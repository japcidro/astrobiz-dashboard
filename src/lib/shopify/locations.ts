// Server-side helper for resolving a Shopify store's default fulfillment
// location. Replaces the client-side /api/shopify/fulfillment/locations
// preload that surfaced as misleading "NO LOCATION" errors when the VA
// scanned before the locations payload settled (waybill-flow regression).
//
// 30-min in-memory cache per store URL. On Fluid Compute the instance is
// reused across requests so cache hits are the common path.

const SHOPIFY_API_VERSION = "2024-01";
const TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { locationId: string; cachedAt: number }>();

interface ShopifyLocation {
  id: number;
  active: boolean;
}

export async function resolveDefaultLocationId(
  storeUrl: string,
  apiToken: string
): Promise<string | null> {
  const cached = cache.get(storeUrl);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.locationId;
  }
  try {
    const res = await fetch(
      `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
      {
        headers: { "X-Shopify-Access-Token": apiToken },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      // Most common cause: token missing read_locations scope (401/403).
      // Without this log the surfaced "no_location" error gave no signal as
      // to why — every failure looked identical to an empty location list.
      const body = await res.text().catch(() => "");
      console.error(
        `[locations] ${storeUrl} returned ${res.status}: ${body.slice(0, 300)}`
      );
      return null;
    }
    const json = (await res.json()) as { locations?: ShopifyLocation[] };
    const locations = json.locations ?? [];
    // Prefer the first active location; fall back to the first one if none
    // are flagged active (small Shopify stores sometimes have a single
    // location that isn't marked active).
    const picked = locations.find((l) => l.active) ?? locations[0];
    if (!picked) {
      console.error(
        `[locations] ${storeUrl} returned 200 but no locations (count=${locations.length})`
      );
      return null;
    }
    const locationId = String(picked.id);
    cache.set(storeUrl, { locationId, cachedAt: Date.now() });
    return locationId;
  } catch (err) {
    console.error(
      `[locations] ${storeUrl} fetch threw:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
