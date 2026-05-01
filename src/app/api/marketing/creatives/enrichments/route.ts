import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

export const dynamic = "force-dynamic";

// GET /api/marketing/creatives/enrichments
//
// Returns the analyzed-status and winner-pool-status maps for ALL ads the
// caller has access to. Designed to be called once per page load alongside
// /api/facebook/all-ads — the client joins by ad_id locally. We don't filter
// by ad_id list because both source tables are tiny (currently ~19 analyses
// and a handful of winner links per store), so the simpler scan-all is
// faster and less code than a 200-id IN-clause round trip.
//
// Response shape:
//   {
//     analyses: { [ad_id]: { has_analysis: true, has_v2: boolean } },
//     winners:  { [ad_id]: {
//                  approved_script_id: string,
//                  label: string,           // angle_title
//                  store_name: string,
//                  performance_status: string,
//                  roas: number | null,
//                  cpp: number | null,
//                  purchases: number | null,
//                  max_consecutive: number | null,
//                  linked_at: string,
//                } }
//   }
//
// Both maps are keyed by fb_ad_id (same id space as all-ads /data[*].ad_id),
// so the client can do row.winner = winners[row.ad_id] in one pass.
export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  // Pull both maps in parallel — neither blocks the other.
  const [analysesRes, linksRes] = await Promise.all([
    supabase.from("ad_creative_analyses").select("ad_id, analysis"),
    supabase
      .from("ad_approved_script_links")
      .select(
        "fb_ad_id, approved_script_id, linked_at, " +
          "approved_scripts(angle_title, store_name, performance_status, performance_metrics)"
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

  // Each link row joins one approved_scripts row. We trust the FK so the
  // nested object is non-null — but Supabase types it as possibly-null, so
  // we narrow defensively.
  interface LinkJoined {
    fb_ad_id: string;
    approved_script_id: string;
    linked_at: string;
    approved_scripts: {
      angle_title: string;
      store_name: string;
      performance_status: string;
      performance_metrics: {
        roas?: number;
        cpp?: number;
        purchases?: number;
        max_consecutive?: number;
      } | null;
    } | null;
  }

  const winners: Record<
    string,
    {
      approved_script_id: string;
      label: string;
      store_name: string;
      performance_status: string;
      roas: number | null;
      cpp: number | null;
      purchases: number | null;
      max_consecutive: number | null;
      linked_at: string;
    }
  > = {};

  for (const row of (linksRes.data ?? []) as unknown as LinkJoined[]) {
    if (!row.approved_scripts) continue;
    const m = row.approved_scripts.performance_metrics ?? {};
    winners[row.fb_ad_id] = {
      approved_script_id: row.approved_script_id,
      label: row.approved_scripts.angle_title,
      store_name: row.approved_scripts.store_name,
      performance_status: row.approved_scripts.performance_status,
      roas: m.roas ?? null,
      cpp: m.cpp ?? null,
      purchases: m.purchases ?? null,
      max_consecutive: m.max_consecutive ?? null,
      linked_at: row.linked_at,
    };
  }

  return Response.json({ analyses, winners });
}
