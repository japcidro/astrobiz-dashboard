import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  fetchAdDailyInsights,
  classifyConsistency,
  DEFAULT_WINNER_THRESHOLDS,
} from "@/lib/facebook/insights-daily";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ai/approved-scripts/promote-external-winner
//
// Turns a deconstructed live FB ad into a "ghost" approved_scripts row marked
// validated_winner, so its DNA flows into the angle generator + format
// expansion via loadWinnersContext.
//
// This is the bridge for ads that predate the script generator (proven
// scalable winners that were created directly in Meta Ads Manager and never
// passed through the autopilot pipeline). The cron at
// /api/cron/auto-deconstruct-winners only promotes ads that were originally
// generated as scripts; this route covers the manual-curation path.
//
// Body: { ad_id, store_name, label }
// - ad_id: fb_ad_id; must already exist in ad_creative_analyses with v2.0
//   fields populated (analysis.viral_mechanism present). Legacy rows are
//   rejected — caller must re-deconstruct first.
// - store_name: human-selected from the existing store dropdown.
// - label: friendly title for the ghost row (default "External winner" client-side).
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_id?: string;
    store_name?: string;
    label?: string;
  };

  if (!body.ad_id || !body.store_name) {
    return Response.json(
      { error: "ad_id and store_name are required" },
      { status: 400 }
    );
  }

  const label = (body.label ?? "External winner").trim() || "External winner";
  const supabase = await createClient();

  // 1. Load the deconstruction. Must be v2.0 — generators only see rows whose
  //    analysis.viral_mechanism is populated, so promoting a legacy row is a
  //    no-op for the loop and gets rejected here.
  const { data: row, error: rowErr } = await supabase
    .from("ad_creative_analyses")
    .select("id, ad_id, account_id, analysis")
    .eq("ad_id", body.ad_id)
    .single();

  if (rowErr || !row) {
    return Response.json(
      { error: "No deconstruction found for that ad. Run analysis first." },
      { status: 404 }
    );
  }

  const analysis = row.analysis as AdDeconstruction;
  if (!analysis?.viral_mechanism) {
    return Response.json(
      {
        error:
          "Legacy deconstruction (v2.0 fields missing). Re-deconstruct this ad first, then add to winners.",
        needs_redeconstruct: true,
      },
      { status: 409 }
    );
  }

  // 2. Reject if this ad has already been added to the pool.
  const { data: existingLink } = await supabase
    .from("ad_approved_script_links")
    .select("approved_script_id")
    .eq("fb_ad_id", body.ad_id)
    .maybeSingle();

  if (existingLink) {
    return Response.json(
      {
        error: "This ad is already linked to an approved script.",
        approved_script_id: existingLink.approved_script_id,
      },
      { status: 409 }
    );
  }

  // 3. Pull 14-day insights from Meta to populate performance_metrics. Falls
  //    back to a winner-marker without metrics if Meta is unreachable —
  //    presence in the pool is what matters; ROAS is an enrichment.
  const service = createServiceClient();
  const { data: tokenRow } = await service
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const fbToken = (tokenRow?.value as string | undefined) ?? null;

  let metrics: {
    roas: number;
    cpp: number;
    purchases: number;
    max_consecutive: number;
  } | null = null;

  if (fbToken) {
    try {
      const daily = await fetchAdDailyInsights(
        body.ad_id,
        row.account_id ?? "",
        fbToken,
        "last_14d"
      );
      const tier = classifyConsistency(daily, DEFAULT_WINNER_THRESHOLDS);
      metrics = {
        roas: daily.total.roas,
        cpp: daily.total.cpp,
        purchases: daily.total.purchases,
        max_consecutive: tier.max_consecutive,
      };
    } catch {
      // Non-fatal — proceed without metrics.
    }
  }

  // 4. Create the ghost approved_scripts row. NOT-NULL columns (hook,
  //    body_script, variant_hooks, status, approved_by, approved_at,
  //    updated_at, variable_shifts) are filled from the deconstruction or
  //    sane defaults. The downstream auto-flip trigger on
  //    ad_approved_script_links will move status from 'approved' → 'submitted'
  //    when we insert the link below, so we set 'approved' here and let the
  //    trigger handle the rest.
  const cls = analysis.classification;
  const hookText = analysis.hook?.description?.slice(0, 1000) || "(see deconstruction)";
  const bodyText =
    analysis.transcript?.slice(0, 8000) || "(see deconstruction)";

  const ghostInsert: Record<string, unknown> = {
    store_name: body.store_name,
    angle_title: label,
    hook: hookText,
    body_script: bodyText,
    variant_hooks: [],
    status: "approved",
    approved_by: employee.id,
    approved_at: new Date().toISOString(),
    updated_by: employee.id,
    updated_at: new Date().toISOString(),
    variable_shifts: { is_external_winner: true, ad_id: body.ad_id },
    awareness_level: cls?.awareness_level ?? null,
    funnel_stage: cls?.funnel_stage ?? null,
    hook_framework: cls?.hook_framework ?? null,
    strategic_format: cls?.strategic_format ?? null,
    video_format: cls?.video_format ?? null,
    big_idea: cls?.angle ?? null,
    avatar: cls?.avatar ?? null,
    angle_type: null,
    intensity: null,
    capacity: null,
    source_winner_ad_id: body.ad_id,
    source_winner_analysis_id: row.id,
    performance_status: "validated_winner",
    performance_validated_at: new Date().toISOString(),
    performance_metrics: metrics,
  };

  const { data: script, error: scriptErr } = await supabase
    .from("approved_scripts")
    .insert(ghostInsert)
    .select("id")
    .single();

  if (scriptErr || !script) {
    return Response.json(
      { error: scriptErr?.message ?? "Failed to create ghost script" },
      { status: 500 }
    );
  }

  // 5. Link the ad → ghost script. Trigger flips status to 'submitted'.
  const { error: linkErr } = await supabase
    .from("ad_approved_script_links")
    .insert({
      fb_ad_id: body.ad_id,
      fb_ad_account_id: row.account_id ?? "unknown",
      approved_script_id: script.id,
      linked_by: employee.id,
    });

  if (linkErr) {
    // Roll back the ghost — leaving an orphan would pollute the winners pool.
    await supabase.from("approved_scripts").delete().eq("id", script.id);
    return Response.json(
      { error: `Link failed: ${linkErr.message}` },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    approved_script_id: script.id,
    label,
    metrics,
  });
}

// GET /api/ai/approved-scripts/promote-external-winner?ad_id=X
// Returns whether this ad is already linked to a winner (for button-state
// rendering on the deconstruction modal).
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const adId = url.searchParams.get("ad_id");
  if (!adId) {
    return Response.json({ error: "ad_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: link } = await supabase
    .from("ad_approved_script_links")
    .select(
      "approved_script_id, approved_scripts(angle_title, store_name, performance_status)"
    )
    .eq("fb_ad_id", adId)
    .maybeSingle();

  if (!link) return Response.json({ in_winners_pool: false });

  const linked = link as unknown as {
    approved_script_id: string;
    approved_scripts: {
      angle_title: string;
      store_name: string;
      performance_status: string;
    } | null;
  };

  return Response.json({
    in_winners_pool: linked.approved_scripts?.performance_status === "validated_winner",
    approved_script_id: linked.approved_script_id,
    label: linked.approved_scripts?.angle_title ?? null,
    store_name: linked.approved_scripts?.store_name ?? null,
  });
}
