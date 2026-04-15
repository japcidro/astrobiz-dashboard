import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// In-memory cache — 30 minutes for locations (rarely change)
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

interface ShopifyLocation {
  id: number;
  name: string;
  active: boolean;
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check cache
  const cacheKey = "shopify-locations";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json(cached.data);
  }

  const supabase = await createClient();

  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData || storesData.length === 0) {
    return Response.json(
      {
        error: storesError
          ? "Failed to load stores"
          : "No active Shopify stores configured.",
      },
      { status: 400 }
    );
  }

  const allLocations: Array<{
    id: number;
    name: string;
    store_name: string;
    active: boolean;
  }> = [];

  // Fetch locations from all stores in parallel
  await Promise.all(
    storesData.map(async (store) => {
      try {
        const res = await fetch(
          `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
          {
            headers: { "X-Shopify-Access-Token": store.api_token },
            cache: "no-store",
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `Shopify API error (${res.status}): ${text.slice(0, 200)}`
          );
        }
        const json = await res.json();
        const locations: ShopifyLocation[] = json.locations || [];

        for (const loc of locations) {
          allLocations.push({
            id: loc.id,
            name: loc.name,
            store_name: store.name,
            active: loc.active,
          });
        }
      } catch (err) {
        console.error(
          `[Locations] Failed to fetch for "${store.name}":`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  const responseData = { locations: allLocations };
  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json(responseData);
}
