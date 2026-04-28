import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

export const dynamic = "force-dynamic";

// GET /api/ai/winner-context?id=<ad_creative_analyses.id>
//
// Resolves a deconstructed winner into a pre-formatted seed message for the
// Angle / Script Creator. Returns:
//   {
//     analysis_id, ad_id, ad_name, store_name, has_v2,
//     seed_user_message: string  // ready to drop into the chat as message[0]
//   }
//
// has_v2=false when the analysis row is a legacy (pre-v2.0) deconstruction.
// In that case the UI shows a "re-deconstruct first" CTA instead of opening
// the chat — the seed message is still returned so the client can preview.

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: analysisRow, error } = await supabase
    .from("ad_creative_analyses")
    .select("id, ad_id, account_id, analysis, thumbnail_url")
    .eq("id", id)
    .single();

  if (error || !analysisRow) {
    return Response.json({ error: "Winner not found" }, { status: 404 });
  }

  const analysis = analysisRow.analysis as AdDeconstruction;
  const hasV2 = Boolean(
    analysis?.viral_mechanism &&
      analysis?.classification &&
      analysis?.beat_map
  );

  // Resolve store via the linked ad_drafts row (which carries store info via
  // the script join) — fallback to deriveStore from account_id if no draft
  // exists yet (manually-uploaded ad case).
  let storeName: string | null = null;
  const { data: draftRow } = await supabase
    .from("ad_drafts")
    .select("source_script_id, name")
    .eq("fb_ad_id", analysisRow.ad_id)
    .limit(1)
    .maybeSingle();

  let adName: string | null = draftRow?.name ?? null;

  if (draftRow?.source_script_id) {
    const { data: scriptRow } = await supabase
      .from("approved_scripts")
      .select("store_name")
      .eq("id", draftRow.source_script_id)
      .maybeSingle();
    storeName = scriptRow?.store_name ?? null;
  }

  // If no draft links this ad to a store, leave null — the client falls
  // back to whatever store is currently selected in the AI Generator UI.

  const seedMessage = buildSeedMessage(analysis, hasV2, adName);

  return Response.json({
    analysis_id: analysisRow.id,
    ad_id: analysisRow.ad_id,
    ad_name: adName,
    store_name: storeName,
    thumbnail_url: analysisRow.thumbnail_url,
    has_v2: hasV2,
    seed_user_message: seedMessage,
  });
}

function buildSeedMessage(
  analysis: AdDeconstruction,
  hasV2: boolean,
  adName: string | null
): string {
  const header = adName
    ? `Expand the following winner: **${adName}**.`
    : "Expand the following winner.";

  if (!hasV2) {
    return `${header}\n\nThis ad was deconstructed before the Winning DNA v2.0 prompt rolled out, so we only have the legacy fields. Re-deconstruct it from the Compare flow to enable full expansion.\n\n— Hook (legacy): ${analysis.hook?.description ?? "—"}\n— Tone: ${analysis.tone ?? "—"}\n— CTA: ${analysis.cta ?? "—"}`;
  }

  const c = analysis.classification;
  const beat = analysis.beat_map;
  const uvp = analysis.uvp;

  const parts: string[] = [
    header,
    "",
    "**Preserve the viral_mechanism. Generate variations that shift at least one of {Who, Level, Stage, Format} relative to this winner. Swapping the actor on camera is NOT variation.**",
    "",
    `**Avatar:** ${c?.avatar ?? "—"}`,
    `**Classification:** ${c?.awareness_level ?? "—"} ${c?.funnel_stage ?? "—"} | Hook: ${c?.hook_framework ?? "—"} | Strategic: ${c?.strategic_format ?? "—"} | Video: ${c?.video_format ?? "—"}`,
    "",
    `**Viral Mechanism:**\n${analysis.viral_mechanism}`,
  ];

  if (beat) {
    parts.push(
      "",
      "**Beat Map:**",
      `  Hook ${beat.hook?.range}: ${beat.hook?.content}`,
      `  Body Open ${beat.body_open?.range}: ${beat.body_open?.content}`,
      `  Body Core ${beat.body_core?.range}: ${beat.body_core?.content}`,
      `  Close ${beat.close?.range}: ${beat.close?.content}`
    );
  }

  if (uvp) {
    parts.push(
      "",
      `**UVP** — Promise: ${uvp.core_promise} | Mechanism: ${uvp.mechanism} | Differentiator: ${uvp.differentiator} | Proof: ${uvp.proof_element}`
    );
  }

  if (analysis.angle_variations && analysis.angle_variations.length > 0) {
    parts.push(
      "",
      "**Pre-computed angle variations from deconstruction (use as starting points):**"
    );
    analysis.angle_variations.forEach((v, i) => {
      parts.push(
        `${i + 1}. ${v.angle} — Hook: ${v.hook_framework} — Formats: ${v.formats}`
      );
    });
  }

  return parts.join("\n");
}
