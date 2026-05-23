import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

export const dynamic = "force-dynamic";

// GET /api/marketing/creatives/enrichments
//
// STUB ROUTE — kept alive for backwards compatibility with the
// marketing/creatives page caller, which expects a 200 response with this
// shape. The approved-scripts / winners enrichment was removed when the
// "Approved Library" feature was killed; the `winners` map is now always
// empty. The `analyses` map remains because the deconstructor (which uses
// `ad_creative_analyses`) is still a live feature.
//
// Response shape:
//   {
//     analyses: { [ad_id]: { has_analysis: true, has_v2: boolean } },
//     winners:  {}   // always empty — approved-scripts feature removed
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

  const analysesRes = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, analysis");

  const analyses: Record<string, { has_analysis: true; has_v2: boolean }> = {};
  for (const row of analysesRes.data ?? []) {
    const r = row as { ad_id: string; analysis: AdDeconstruction };
    analyses[r.ad_id] = {
      has_analysis: true,
      has_v2: !!r.analysis?.viral_mechanism,
    };
  }

  // Approved-scripts enrichment is gone. Keep the key for backwards compat
  // with callers that destructure { winners } — they'll just see an empty
  // object and skip the winner badge entirely.
  const winners: Record<string, never> = {};

  return Response.json({ analyses, winners });
}
