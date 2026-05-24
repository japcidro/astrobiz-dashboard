import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

interface ScalingRow {
  fb_ad_id: string;
  in_scaling: boolean;
  self_is_scaling: boolean;
}

interface ActionRow {
  ad_id: string | null;
  action: string;
  rule_matched: string | null;
  actor_id: string | null;
  created_at: string;
}

export const dynamic = "force-dynamic";

// GET /api/marketing/creatives/enrichments
//
// Side-loaded data the Creatives page joins to FB ad rows by ad_id:
//   - analyses:     which ads have a Gemini deconstruction (+ v2.0 fields)
//   - scaling:      per-ad self_is_scaling / in_scaling from
//                   scaling_detection_cache (refreshed every 30 min)
//   - attributions: for currently-paused ads, who/what paused them —
//                   reads the latest autopilot_actions row per ad.
//                   source='autopilot' includes rule_matched (e.g.
//                   high_cpa). source='manual' includes actor_name from
//                   the employees join. Ads paused directly in FB Ads
//                   Manager have no record here.
//   - winners:      always empty — approved-scripts feature was removed
//                   (kept in shape for backwards compat)
//
// Response shape:
//   {
//     analyses:     { [ad_id]: { has_analysis: true, has_v2: boolean } },
//     scaling:      { [ad_id]: { self_is_scaling: boolean, in_scaling: boolean } },
//     attributions: { [ad_id]: { source, reason, actor_name, at } },
//     winners:      {}
//   }
export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const [analysesRes, scalingRes, actionsRes] = await Promise.all([
    supabase.from("ad_creative_analyses").select("ad_id, analysis"),
    // scaling_detection_cache has ~6k rows; bare .select() would silently
    // cap at 1000. Page through with fetchAllRows.
    fetchAllRows<ScalingRow>(
      () =>
        supabase
          .from("scaling_detection_cache")
          .select("fb_ad_id, in_scaling, self_is_scaling"),
      { orderColumn: "fb_ad_id" }
    ),
    // Recent pause/resume actions. We pull only paused/resumed (skip
    // 'error' rows) and dedupe to the latest-per-ad client-side.
    supabase
      .from("autopilot_actions")
      .select("ad_id, action, rule_matched, actor_id, created_at")
      .in("action", ["paused", "resumed", "manual_paused", "manual_resumed"])
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const analyses: Record<string, { has_analysis: true; has_v2: boolean }> = {};
  for (const row of analysesRes.data ?? []) {
    const r = row as { ad_id: string; analysis: AdDeconstruction };
    analyses[r.ad_id] = {
      has_analysis: true,
      has_v2: !!r.analysis?.viral_mechanism,
    };
  }

  const scaling: Record<
    string,
    { self_is_scaling: boolean; in_scaling: boolean }
  > = {};
  for (const r of scalingRes.data ?? []) {
    scaling[r.fb_ad_id] = {
      self_is_scaling: r.self_is_scaling,
      in_scaling: r.in_scaling,
    };
  }

  // Build latest action per ad. Only currently-paused state (latest
  // action is a paused-type) gets surfaced as an attribution; if the
  // latest is a resumed, the ad is back on → no attribution needed.
  const latestActionByAd = new Map<string, ActionRow>();
  for (const row of (actionsRes.data ?? []) as ActionRow[]) {
    if (!row.ad_id || latestActionByAd.has(row.ad_id)) continue;
    latestActionByAd.set(row.ad_id, row);
  }

  const pausedActions: ActionRow[] = [];
  for (const a of latestActionByAd.values()) {
    if (a.action === "paused" || a.action === "manual_paused") {
      pausedActions.push(a);
    }
  }

  // Hydrate actor display names for manual pauses
  const actorIds = Array.from(
    new Set(
      pausedActions
        .map((a) => a.actor_id)
        .filter((v): v is string => !!v)
    )
  );
  const actorNameMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", actorIds);
    for (const e of (emps ?? []) as { id: string; full_name: string | null }[]) {
      if (e.full_name) actorNameMap.set(e.id, e.full_name);
    }
  }

  const attributions: Record<
    string,
    {
      source: "autopilot" | "manual";
      reason: string | null;
      actor_name: string | null;
      at: string;
    }
  > = {};
  for (const a of pausedActions) {
    if (!a.ad_id) continue;
    const isAuto = a.action === "paused";
    attributions[a.ad_id] = {
      source: isAuto ? "autopilot" : "manual",
      reason: isAuto ? a.rule_matched : null,
      actor_name: a.actor_id ? actorNameMap.get(a.actor_id) ?? null : null,
      at: a.created_at,
    };
  }

  const winners: Record<string, never> = {};

  return Response.json({ analyses, scaling, attributions, winners });
}
