import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

interface ScalingRow {
  fb_ad_id: string;
  in_scaling: boolean;
}

export const dynamic = "force-dynamic";

// GET /api/marketing/creatives/enrichments
//
// Side-loaded data the Creatives page joins to FB ad rows by ad_id:
//   - analyses: which ads have a Gemini deconstruction (and v2.0 fields)
//   - scaling:  which ads are currently inside a scaling campaign (from
//               scaling_detection_cache, refreshed every 30 min by cron)
//   - winners:  always empty — approved-scripts feature was removed
//               (kept in the response shape for backwards compat)
//
// Response shape:
//   {
//     analyses: { [ad_id]: { has_analysis: true, has_v2: boolean } },
//     scaling:  { [ad_id]: { in_scaling: boolean } },
//     winners:  {}
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

  const [analysesRes, scalingRes] = await Promise.all([
    supabase.from("ad_creative_analyses").select("ad_id, analysis"),
    // scaling_detection_cache has ~6k rows; bare .select() would silently
    // cap at 1000. Page through with fetchAllRows.
    fetchAllRows<ScalingRow>(
      () =>
        supabase
          .from("scaling_detection_cache")
          .select("fb_ad_id, in_scaling"),
      { orderColumn: "fb_ad_id" }
    ),
  ]);

  const analyses: Record<string, { has_analysis: true; has_v2: boolean }> = {};
  for (const row of analysesRes.data ?? []) {
    const r = row as { ad_id: string; analysis: AdDeconstruction };
    analyses[r.ad_id] = {
      has_analysis: true,
      has_v2: !!r.analysis?.viral_mechanism,
    };
  }

  const scaling: Record<string, { in_scaling: boolean }> = {};
  for (const r of scalingRes.data ?? []) {
    scaling[r.fb_ad_id] = { in_scaling: r.in_scaling };
  }

  const winners: Record<string, never> = {};

  return Response.json({ analyses, scaling, winners });
}
