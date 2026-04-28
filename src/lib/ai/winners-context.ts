// Loads validated-winner context for injection into the Angle Generator,
// Script Creator, and Format Expansion prompts.
//
// A "validated winner" is an approved_scripts row whose linked live FB ad
// reached stable_winner tier (ROAS ≥ 5.0x for ≥3 consecutive days), which
// the auto-deconstruct-winners cron flips on. The cron also backfills the
// v2.0 classification fields (hook_framework / strategic_format / video_format
// / awareness_level / funnel_stage) onto the approved_scripts row from the
// freshly-deconstructed live ad's analysis.
//
// We pull the freshest joined deconstruction and render a compact text block
// per winner — the generator gets to see the *actual* winning DNA from
// production, not the static, hand-written winning_ad_template doc.
//
// This block goes into the `system` array as its own cache_control checkpoint
// so the static system+knowledge prefix stays cached even when winners change.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDeconstruction } from "@/lib/ai/compare-types";

const STALENESS_DAYS = 45;
const DEFAULT_LIMIT = 5;

interface WinnerRow {
  id: string;
  angle_title: string;
  awareness_level: string | null;
  funnel_stage: string | null;
  hook_framework: string | null;
  strategic_format: string | null;
  video_format: string | null;
  performance_metrics: {
    roas?: number;
    cpp?: number;
    purchases?: number;
    max_consecutive?: number;
  } | null;
  performance_validated_at: string | null;
}

interface DraftRow {
  source_script_id: string;
  fb_ad_id: string;
}

interface AnalysisRow {
  ad_id: string;
  analysis: AdDeconstruction;
}

export interface WinnerContext {
  text: string;           // rendered prompt block, ready to drop into systemBlocks
  winner_count: number;
  winner_ids: string[];   // approved_scripts.id values used (for thread provenance)
}

// Returns null when there are zero usable winners — caller should skip the
// injection entirely so the generator falls back to the manual
// winning_ad_template doc.
export async function loadWinnersContext(
  supabase: SupabaseClient,
  storeName: string,
  limit = DEFAULT_LIMIT
): Promise<WinnerContext | null> {
  const stalenessCutoff = new Date(
    Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // 1. Pull recent validated-winner scripts for this store, sorted by
  //    performance signal strength.
  const { data: scriptRows, error: scriptsErr } = await supabase
    .from("approved_scripts")
    .select(
      "id, angle_title, awareness_level, funnel_stage, hook_framework, " +
        "strategic_format, video_format, performance_metrics, performance_validated_at"
    )
    .eq("store_name", storeName)
    .eq("performance_status", "validated_winner")
    .gte("performance_validated_at", stalenessCutoff)
    .order("performance_validated_at", { ascending: false })
    .limit(limit * 3); // over-fetch — some scripts won't have a deconstruction yet

  if (scriptsErr || !scriptRows || scriptRows.length === 0) return null;

  const scripts = scriptRows as unknown as WinnerRow[];

  // 2. Resolve each script → linked live ad → deconstruction. We go through
  //    ad_drafts because that's where the script→ad link is persisted by the
  //    bulk-create / autopilot flows. A script can have multiple drafts, but
  //    the cron promotes from one stable_winner draft at a time, so usually
  //    only one will have an analysis row.
  const scriptIds = scripts.map((s) => s.id);
  const { data: draftRows } = await supabase
    .from("ad_drafts")
    .select("source_script_id, fb_ad_id")
    .in("source_script_id", scriptIds)
    .not("fb_ad_id", "is", null);

  const draftsByScript = new Map<string, string[]>();
  for (const d of (draftRows || []) as DraftRow[]) {
    const arr = draftsByScript.get(d.source_script_id) ?? [];
    arr.push(d.fb_ad_id);
    draftsByScript.set(d.source_script_id, arr);
  }

  const allAdIds = Array.from(
    new Set((draftRows || []).map((d) => d.fb_ad_id as string))
  );
  if (allAdIds.length === 0) return null;

  const { data: analysisRows } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, analysis")
    .in("ad_id", allAdIds);

  const analysisByAd = new Map<string, AdDeconstruction>();
  for (const a of (analysisRows || []) as AnalysisRow[]) {
    if (a.analysis?.viral_mechanism) {
      analysisByAd.set(a.ad_id, a.analysis);
    }
  }

  // 3. Render up to `limit` blocks, each in the same shape so the model can
  //    pattern-match across them. Skip scripts whose linked ads have no v2.0
  //    deconstruction yet (legacy or pre-v2 rows).
  const blocks: string[] = [];
  const usedIds: string[] = [];

  for (const s of scripts) {
    if (blocks.length >= limit) break;
    const draftIds = draftsByScript.get(s.id) ?? [];
    let analysis: AdDeconstruction | undefined;
    for (const adId of draftIds) {
      const a = analysisByAd.get(adId);
      if (a) {
        analysis = a;
        break;
      }
    }
    if (!analysis || !analysis.viral_mechanism) continue;

    blocks.push(renderWinnerBlock(s, analysis));
    usedIds.push(s.id);
  }

  if (blocks.length === 0) return null;

  const header = `## VALIDATED WINNERS (live ads from ${storeName} that hit stable_winner: ROAS ≥ 5.0x for ≥3 consecutive days, deconstructed from production)
The viral_mechanism on each is the strongest signal you have. When asked to generate angles or scripts, prefer variations that PRESERVE the viral_mechanism while shifting at least one of {Who, Level, Stage, Format}. Swapping the actor on camera is NOT variation.
`;

  return {
    text: header + "\n" + blocks.join("\n\n"),
    winner_count: blocks.length,
    winner_ids: usedIds,
  };
}

function renderWinnerBlock(
  s: WinnerRow,
  analysis: AdDeconstruction
): string {
  const m = s.performance_metrics ?? {};
  const c = analysis.classification;
  const beat = analysis.beat_map;
  const uvp = analysis.uvp;

  const metricsLine = [
    m.roas ? `ROAS ${m.roas.toFixed(2)}x` : null,
    m.max_consecutive ? `${m.max_consecutive}-day streak` : null,
    m.cpp ? `CPP ₱${m.cpp.toFixed(0)}` : null,
    m.purchases ? `${m.purchases} purchases` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const classLine = c
    ? `Avatar: ${c.avatar}\nClassification: ${c.awareness_level} ${c.funnel_stage} | Hook: ${c.hook_framework} | Strategic: ${c.strategic_format} | Video: ${c.video_format}`
    : `Hook: ${s.hook_framework ?? "—"} | Strategic: ${s.strategic_format ?? "—"} | Video: ${s.video_format ?? "—"}`;

  const beatBlock = beat
    ? `Beat Map:
  Hook ${beat.hook.range}: ${beat.hook.content}
  Body Open ${beat.body_open.range}: ${beat.body_open.content}
  Body Core ${beat.body_core.range}: ${beat.body_core.content}
  Close ${beat.close.range}: ${beat.close.content}`
    : "";

  const uvpLine = uvp
    ? `UVP — Promise: ${uvp.core_promise} | Mechanism: ${uvp.mechanism} | Differentiator: ${uvp.differentiator} | Proof: ${uvp.proof_element}`
    : "";

  return [
    `=== WINNER: ${s.angle_title}${metricsLine ? ` (${metricsLine})` : ""} ===`,
    classLine,
    `Viral Mechanism: ${analysis.viral_mechanism}`,
    beatBlock,
    uvpLine,
  ]
    .filter(Boolean)
    .join("\n");
}
