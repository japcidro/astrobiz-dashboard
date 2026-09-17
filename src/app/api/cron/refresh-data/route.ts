import { createServiceClient } from "@/lib/supabase/service";
import { buildCacheKey, setCachedResponse } from "@/lib/data-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

// Date presets to pre-compute
const PNL_DATE_FILTERS = ["today", "yesterday", "last_7d", "this_month", "last_30d"];
// IMPORTANT: these strings MUST match the values the dashboard sends from
// DATE_PRESETS in marketing/creatives/page.tsx and marketing/ads/page.tsx.
// A previous version used "last_7_days"/"last_30_days" (with underscores)
// which silently warmed cache keys the UI never reads — every dashboard
// view stayed days stale. Keep these aligned with the UI list.
// Split by how fast the window actually moves. Today and yesterday are what
// the team watches minute to minute; the rolling windows barely shift between
// two half-hourly runs, and walking all six every time was most of our
// Facebook call budget. The wide ones warm once an hour instead.
const ADS_FREQUENT_PRESETS = ["today", "yesterday"];
const ADS_HOURLY_PRESETS = ["last_7d", "last_14d", "last_30d", "this_month"];

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
  // This cron fires on the hour and on the half hour; only the :00 run pays
  // for the wide rolling windows.
  const onTheHour = new Date().getUTCMinutes() < 30;
  const adsPresets = [
    ...ADS_FREQUENT_PRESETS,
    ...(onTheHour ? ADS_HOURLY_PRESETS : []),
  ];

  for (const datePreset of adsPresets) {
    try {
      const params = new URLSearchParams({
        date_preset: datePreset,
        account: "ALL",
        refresh: "1",
      });

      // /all-ads writes its own cache entry under the key the dashboard
      // reads. Re-caching the response here only ever wrote a second key
      // ("ads:…") that nothing read — a multi-megabyte write per preset for
      // nothing — so the response is now just checked, not stored.
      const res = await fetch(`${baseUrl}/api/facebook/all-ads?${params}`, {
        headers: cronAuth,
        cache: "no-store",
      });

      if (!res.ok) {
        errors.push(`ads:ALL:${datePreset} (${res.status})`);
        continue;
      }

      // A rate-limited refresh still answers 200 with the previous payload
      // marked stale. Counting that as a success hid the outage: the cache
      // sat 18 hours old while every run reported "ok".
      const data = (await res.json()) as { rate_limited?: boolean; stale?: boolean };
      if (data.rate_limited || data.stale) {
        errors.push(`ads:ALL:${datePreset} (rate-limited, served stale)`);
      } else {
        results.push(`ads:ALL:${datePreset}`);
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
