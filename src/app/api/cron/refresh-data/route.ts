import { createServiceClient } from "@/lib/supabase/service";
import { buildCacheKey, setCachedResponse } from "@/lib/data-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

// Date presets to pre-compute
const PNL_DATE_FILTERS = ["today", "yesterday", "last_7d", "this_month", "last_30d"];
const ADS_DATE_PRESETS = ["today", "yesterday", "last_7_days", "this_month", "last_30_days"];

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cronSecret = process.env.CRON_SECRET!;
  const results: string[] = [];
  const errors: string[] = [];
  const startTime = Date.now();

  // Get base URL for internal API calls
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Auth header for internal calls (bypasses user auth on API routes)
  const cronAuth = { Authorization: `Bearer ${cronSecret}` };

  // --- 1. Refresh P&L data ---
  const { data: stores } = await supabase
    .from("shopify_stores")
    .select("name")
    .eq("is_active", true);

  const storeFilters = ["ALL", ...(stores || []).map((s) => s.name.toUpperCase())];

  for (const dateFilter of PNL_DATE_FILTERS) {
    for (const store of storeFilters) {
      try {
        const params = new URLSearchParams({
          store,
          date_filter: dateFilter,
          refresh: "1",
        });

        const res = await fetch(`${baseUrl}/api/profit/daily?${params}`, {
          headers: cronAuth,
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          const cacheKey = buildCacheKey("pnl", {
            store,
            date_filter: dateFilter,
            date_from: "",
            date_to: "",
          });
          await setCachedResponse(supabase, "pnl", cacheKey, data);
          results.push(`pnl:${store}:${dateFilter}`);
        } else {
          errors.push(`pnl:${store}:${dateFilter} (${res.status})`);
        }
      } catch (err) {
        errors.push(`pnl:${store}:${dateFilter}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  // --- 2. Refresh FB Ads data ---
  for (const datePreset of ADS_DATE_PRESETS) {
    try {
      const params = new URLSearchParams({
        date_preset: datePreset,
        account: "ALL",
        refresh: "1",
      });

      const res = await fetch(`${baseUrl}/api/facebook/all-ads?${params}`, {
        headers: cronAuth,
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        const cacheKey = buildCacheKey("ads", {
          date_preset: datePreset,
          account: "ALL",
        });
        await setCachedResponse(supabase, "ads", cacheKey, data);
        results.push(`ads:ALL:${datePreset}`);
      } else {
        errors.push(`ads:ALL:${datePreset} (${res.status})`);
      }
    } catch (err) {
      errors.push(`ads:ALL:${datePreset}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  return Response.json({
    success: true,
    refreshed: results.length,
    errors: errors.length,
    error_details: errors,
    duration_seconds: duration,
    timestamp: new Date().toISOString(),
  });
}
