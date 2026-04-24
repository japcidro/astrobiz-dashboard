import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Reads precomputed scaling info from scaling_detection_cache. The cache
// is refreshed every 30 min by /api/cron/refresh-scaling-detection — see
// that route for the FB-touching logic. This endpoint NEVER calls FB.
//
// POST /api/marketing/scaling/detect
// Body: { ad_ids: string[] }
// Returns: { results: Record<ad_id, ScalingInfo>, stale_at, source: "cache" }
//
// Ads not yet in cache (newly launched, hasn't been picked up by the
// next cron run) come back with default zero-scaling info. They'll show
// correct badges after the next cron tick.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { ad_ids?: string[] };
  const adIds = Array.isArray(body.ad_ids)
    ? body.ad_ids.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  if (adIds.length === 0) {
    return Response.json({ results: {}, source: "cache" });
  }
  if (adIds.length > 1000) {
    return Response.json(
      { error: "Too many ad_ids — max 1000 per call" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Read precomputed results in one DB query — instant.
  const { data: rows, error } = await supabase
    .from("scaling_detection_cache")
    .select(
      "fb_ad_id, in_scaling, scaled_ad_id, scaled_in_campaign, scaled_in_store, self_is_scaling"
    )
    .in("fb_ad_id", adIds);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const results: Record<
    string,
    {
      in_scaling: boolean;
      scaled_ad_id: string | null;
      scaled_in_campaign: string | null;
      scaled_in_store: string | null;
      self_is_scaling: boolean;
    }
  > = {};

  // Default zero-scaling for ads we haven't computed yet — keeps the
  // client UI consistent (no missing keys) while the cron catches up.
  for (const adId of adIds) {
    results[adId] = {
      in_scaling: false,
      scaled_ad_id: null,
      scaled_in_campaign: null,
      scaled_in_store: null,
      self_is_scaling: false,
    };
  }
  for (const row of rows ?? []) {
    results[row.fb_ad_id] = {
      in_scaling: !!row.in_scaling,
      scaled_ad_id: row.scaled_ad_id ?? null,
      scaled_in_campaign: row.scaled_in_campaign ?? null,
      scaled_in_store: row.scaled_in_store ?? null,
      self_is_scaling: !!row.self_is_scaling,
    };
  }

  // Surface staleness + cron status so the UI can show "scaling badges
  // last refreshed X mins ago" if it wants to.
  const { data: state } = await supabase
    .from("fb_refresh_state")
    .select("refreshed_at")
    .eq("scope", "scaling_detection")
    .maybeSingle();

  return Response.json({
    results,
    source: "cache",
    refreshed_at: state?.refreshed_at ?? null,
  });
}
