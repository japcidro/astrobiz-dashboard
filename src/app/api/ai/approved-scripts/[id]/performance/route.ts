import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  loadDraftLinks,
  computeScriptPerformance,
} from "@/lib/ai/script-performance";
import type { DatePreset } from "@/lib/facebook/types";

export const dynamic = "force-dynamic";

// GET /api/ai/approved-scripts/[id]/performance?date_preset=last_14d
// Returns detailed performance for a single script INCLUDING per-ad
// breakdown and per-day timelines. Used by the Library detail modal.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const datePreset = (searchParams.get("date_preset") || "last_14d") as DatePreset;

  const supabase = await createClient();

  const [scriptRes, tokenRes] = await Promise.all([
    supabase
      .from("approved_scripts")
      .select("id, store_name")
      .eq("id", id)
      .single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
  ]);

  if (scriptRes.error || !scriptRes.data) {
    return Response.json({ error: "Script not found" }, { status: 404 });
  }

  const fbToken = (tokenRes.data?.value as string | undefined) ?? "";
  const linksByScript = await loadDraftLinks(supabase, [id]);
  const drafts = linksByScript.get(id) ?? [];

  if (!fbToken) {
    return Response.json({
      performance: {
        script_id: id,
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
        ads: [],
      },
      warning: "Facebook token not configured — live metrics unavailable",
    });
  }

  try {
    const performance = await computeScriptPerformance(id, drafts, {
      fbToken,
      datePreset,
      includeDaily: true,
      supabaseForDeconstructions: supabase,
    });
    return Response.json({ performance, date_preset: datePreset });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Failed to load performance",
      },
      { status: 500 }
    );
  }
}
