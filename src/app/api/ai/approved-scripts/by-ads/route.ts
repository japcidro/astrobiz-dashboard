import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ScriptByAd {
  script_id: string;
  angle_title: string;
  store_name: string;
  // "manual" = explicit link via ad_approved_script_links (marketer
  // tagged the live ad from the Ad Performance view). "draft" = ad was
  // originally created through the bulk-create drafts flow, so the link
  // is implicit via ad_drafts.source_script_id.
  source: "manual" | "draft";
}

// Given a list of fb_ad_ids, return a mapping of ad_id → approved-script info.
// UNIONs two sources:
//   1. ad_approved_script_links (explicit manual tags — higher priority)
//   2. ad_drafts.source_script_id  (implicit from draft creation flow)
// Used by both the Creative Deconstruction panel and the Ad Performance
// "Link to Library" button to render "Generated from Script #X" badges.
//
// POST /api/ai/approved-scripts/by-ads
// Body: { ad_ids: string[] }
// Returns: { mapping: Record<fb_ad_id, ScriptByAd> }
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
  const mapping: Record<string, ScriptByAd> = {};

  type JoinedScript = {
    id: string;
    angle_title: string;
    store_name: string;
  };

  // --- Source 1: draft-sourced ads (implicit link via ad_drafts) ---
  const { data: drafts, error: draftsErr } = await supabase
    .from("ad_drafts")
    .select(
      "fb_ad_id, source_script_id, approved_scripts:source_script_id(id, angle_title, store_name)"
    )
    .in("fb_ad_id", adIds)
    .not("source_script_id", "is", null);

  if (draftsErr) {
    return Response.json({ error: draftsErr.message }, { status: 500 });
  }

  type DraftJoin = {
    fb_ad_id: string | null;
    source_script_id: string | null;
    approved_scripts: JoinedScript | JoinedScript[] | null;
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
      source: "draft",
    };
  }

  // --- Source 2: manual links (overwrite draft mapping — marketer intent wins) ---
  const { data: links, error: linksErr } = await supabase
    .from("ad_approved_script_links")
    .select(
      "fb_ad_id, approved_script_id, approved_scripts:approved_script_id(id, angle_title, store_name)"
    )
    .in("fb_ad_id", adIds);

  if (linksErr) {
    return Response.json({ error: linksErr.message }, { status: 500 });
  }

  type LinkJoin = {
    fb_ad_id: string | null;
    approved_script_id: string | null;
    approved_scripts: JoinedScript | JoinedScript[] | null;
  };

  for (const row of (links || []) as LinkJoin[]) {
    if (!row.fb_ad_id || !row.approved_script_id) continue;
    const joined = Array.isArray(row.approved_scripts)
      ? row.approved_scripts[0]
      : row.approved_scripts;
    if (!joined) continue;
    mapping[row.fb_ad_id] = {
      script_id: joined.id,
      angle_title: joined.angle_title,
      store_name: joined.store_name,
      source: "manual",
    };
  }

  return Response.json({ mapping });
}
