import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ScriptByAd {
  script_id: string;
  angle_title: string;
  store_name: string;
}

// Given a list of fb_ad_ids, return a mapping of ad_id → approved-script info
// by joining ad_drafts → approved_scripts. Used by the Creative Deconstruction
// panel to surface "Generated from Script #X" badges on script-sourced ads.
//
// POST /api/ai/approved-scripts/by-ads
// Body: { ad_ids: string[] }
// Returns: { mapping: Record<fb_ad_id, { script_id, angle_title, store_name }> }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { ad_ids?: string[] };
  const adIds = Array.isArray(body.ad_ids) ? body.ad_ids.filter(Boolean) : [];
  if (adIds.length === 0) {
    return Response.json({ mapping: {} });
  }

  const supabase = await createClient();

  const { data: drafts, error } = await supabase
    .from("ad_drafts")
    .select(
      "fb_ad_id, source_script_id, approved_scripts:source_script_id(id, angle_title, store_name)"
    )
    .in("fb_ad_id", adIds)
    .not("source_script_id", "is", null);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const mapping: Record<string, ScriptByAd> = {};
  type DraftJoin = {
    fb_ad_id: string | null;
    source_script_id: string | null;
    approved_scripts:
      | { id: string; angle_title: string; store_name: string }
      | { id: string; angle_title: string; store_name: string }[]
      | null;
  };

  for (const row of (drafts || []) as DraftJoin[]) {
    if (!row.fb_ad_id || !row.source_script_id) continue;
    const joined = Array.isArray(row.approved_scripts)
      ? row.approved_scripts[0]
      : row.approved_scripts;
    if (!joined) continue;
    mapping[row.fb_ad_id] = {
      script_id: joined.id,
      angle_title: joined.angle_title,
      store_name: joined.store_name,
    };
  }

  return Response.json({ mapping });
}
