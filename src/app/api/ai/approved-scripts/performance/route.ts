import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  loadDraftLinks,
  computeScriptPerformance,
  type ScriptPerformance,
} from "@/lib/ai/script-performance";
import type { DatePreset } from "@/lib/facebook/types";

export const dynamic = "force-dynamic";

// GET /api/ai/approved-scripts/performance?store=X&date_preset=last_14d
// Returns performance for ALL approved scripts in a store — used by the
// Approved Library listing to show winner badges and quick metrics on each card.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");
  const datePreset = (searchParams.get("date_preset") || "last_14d") as DatePreset;

  if (!store) {
    return Response.json({ error: "store param required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Pull scripts for the store and the FB token in parallel
  const [scriptsRes, tokenRes] = await Promise.all([
    supabase
      .from("approved_scripts")
      .select("id")
      .eq("store_name", store),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
  ]);

  if (scriptsRes.error) {
    return Response.json({ error: scriptsRes.error.message }, { status: 500 });
  }
  const scriptIds = (scriptsRes.data || []).map((s) => s.id as string);
  if (scriptIds.length === 0) {
    return Response.json({ performance: {} });
  }

  const fbToken = (tokenRes.data?.value as string | undefined) ?? "";
  const linksByScript = await loadDraftLinks(supabase, scriptIds);

  // Short-circuit for scripts with zero launched ads (most common case for new
  // stores). No FB call needed — emit no_data rows directly.
  const performance: Record<string, ScriptPerformance> = {};
  const scriptsNeedingFb: string[] = [];

  for (const scriptId of scriptIds) {
    const drafts = linksByScript.get(scriptId) ?? [];
    const hasLaunched = drafts.some((d) => d.fb_ad_id);
    if (!hasLaunched) {
      performance[scriptId] = {
        script_id: scriptId,
        draft_count: drafts.length,
        submitted_count: 0,
        live_count: 0,
        spend: 0,
        purchases: 0,
        purchase_value: 0,
        cpp: 0,
        roas: 0,
        tier: "no_data",
        best_ad: null,
      };
    } else {
      scriptsNeedingFb.push(scriptId);
    }
  }

  if (scriptsNeedingFb.length > 0 && !fbToken) {
    // We have launched ads but no token — return partial (drafts counts only)
    for (const scriptId of scriptsNeedingFb) {
      const drafts = linksByScript.get(scriptId) ?? [];
      performance[scriptId] = {
        script_id: scriptId,
        draft_count: drafts.length,
        submitted_count: drafts.filter((d) => d.fb_ad_id).length,
        live_count: drafts.filter(
          (d) => d.fb_ad_id && d.status === "submitted"
        ).length,
        spend: 0,
        purchases: 0,
        purchase_value: 0,
        cpp: 0,
        roas: 0,
        tier: "no_data",
        best_ad: null,
      };
    }
    return Response.json({
      performance,
      warning: "Facebook token not configured — live metrics unavailable",
    });
  }

  // Process the remaining scripts sequentially — each call is already
  // internally concurrent up to 4 parallel ad fetches. Running scripts in
  // parallel would multiply the concurrency uncontrollably.
  for (const scriptId of scriptsNeedingFb) {
    const drafts = linksByScript.get(scriptId) ?? [];
    try {
      performance[scriptId] = await computeScriptPerformance(scriptId, drafts, {
        fbToken,
        datePreset,
        includeDaily: false,
      });
    } catch {
      performance[scriptId] = {
        script_id: scriptId,
        draft_count: drafts.length,
        submitted_count: drafts.filter((d) => d.fb_ad_id).length,
        live_count: drafts.filter(
          (d) => d.fb_ad_id && d.status === "submitted"
        ).length,
        spend: 0,
        purchases: 0,
        purchase_value: 0,
        cpp: 0,
        roas: 0,
        tier: "no_data",
        best_ad: null,
      };
    }
  }

  return Response.json({ performance, date_preset: datePreset });
}
