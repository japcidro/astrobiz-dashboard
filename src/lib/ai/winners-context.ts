// Loads validated-winner context for injection into the Angle Generator,
// Script Creator, and Format Expansion prompts.
//
// A "validated winner" is an approved_scripts row whose linked live FB ad
// reached stable_winner tier (ROAS ≥ 5.0x for ≥3 consecutive days). Two paths
// promote a script to validated_winner:
//   1. The auto-deconstruct-winners cron — for scripts that flowed through
//      the autopilot (linked via ad_drafts.source_script_id).
//   2. The "Add to Winners" button on the deconstruction modal — for ads
//      that predate the script generator. Creates a "ghost" approved_scripts
//      row marked validated_winner, then inserts ad_approved_script_links.
//
// Both paths converge here. We resolve each script → live FB ad via *either*
// ad_drafts or ad_approved_script_links, then pull the freshest deconstruction
// from ad_creative_analyses and render a compact text block per winner.
//
// Winners are sorted by ROAS descending (with recency tiebreaker) so the
// strongest signal lands at the top of the prompt where attention is highest.
// Each block surfaces the deconstruct's format_compatibility + angle_variations
// so the generator can use them as concrete starting points instead of
// inventing from scratch.
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

interface LinkRow {
  approved_script_id: string;
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

  // 1. Pull recent validated-winner scripts for this store. We over-fetch
  //    because some scripts won't have a deconstruction joined through
  //    either link table.
  const { data: scriptRows, error: scriptsErr } = await supabase
    .from("approved_scripts")
    .select(
      "id, angle_title, awareness_level, funnel_stage, hook_framework, " +
        "strategic_format, video_format, performance_metrics, performance_validated_at"
    )
    .eq("store_name", storeName)
    .eq("performance_status", "validated_winner")
    .gte("performance_validated_at", stalenessCutoff)
    .limit(limit * 4);

  if (scriptsErr || !scriptRows || scriptRows.length === 0) return null;

  const scripts = scriptRows as unknown as WinnerRow[];

  // 2. Resolve each script → linked live ad. Two link sources:
  //    (a) ad_drafts.source_script_id — autopilot/bulk-create flow.
  //    (b) ad_approved_script_links.approved_script_id — manual link OR the
  //        "Add to Winners" button (ghost rows for external winners).
  //    Either path is sufficient. We collect all candidate fb_ad_ids per
  //    script — the cron typically promotes one stable_winner draft at a
  //    time, so usually only one ad has a v2.0 deconstruction.
  const scriptIds = scripts.map((s) => s.id);

  const [{ data: draftRows }, { data: linkRows }] = await Promise.all([
    supabase
      .from("ad_drafts")
      .select("source_script_id, fb_ad_id")
      .in("source_script_id", scriptIds)
      .not("fb_ad_id", "is", null),
    supabase
      .from("ad_approved_script_links")
      .select("approved_script_id, fb_ad_id")
      .in("approved_script_id", scriptIds),
  ]);

  const adsByScript = new Map<string, string[]>();
  for (const d of (draftRows || []) as DraftRow[]) {
    const arr = adsByScript.get(d.source_script_id) ?? [];
    arr.push(d.fb_ad_id);
    adsByScript.set(d.source_script_id, arr);
  }
  for (const l of (linkRows || []) as LinkRow[]) {
    const arr = adsByScript.get(l.approved_script_id) ?? [];
    if (!arr.includes(l.fb_ad_id)) arr.push(l.fb_ad_id);
    adsByScript.set(l.approved_script_id, arr);
  }

  const allAdIds = Array.from(
    new Set(Array.from(adsByScript.values()).flat())
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

  // 3. Pair each script with its best v2.0 deconstruction, then rank by
  //    performance. ROAS desc is the primary signal; recency is the
  //    tiebreaker so a fresh 6.0x edges a 6-week-old 6.0x. Scripts whose
  //    linked ads have no v2.0 deconstruction are skipped — they'd render
  //    as empty noise in the prompt.
  interface Paired {
    script: WinnerRow;
    analysis: AdDeconstruction;
  }
  const paired: Paired[] = [];
  for (const s of scripts) {
    const adIds = adsByScript.get(s.id) ?? [];
    let analysis: AdDeconstruction | undefined;
    for (const adId of adIds) {
      const a = analysisByAd.get(adId);
      if (a) {
        analysis = a;
        break;
      }
    }
    if (!analysis) continue;
    paired.push({ script: s, analysis });
  }

  paired.sort((a, b) => {
    const ra = a.script.performance_metrics?.roas ?? 0;
    const rb = b.script.performance_metrics?.roas ?? 0;
    if (rb !== ra) return rb - ra;
    const da = a.script.performance_validated_at
      ? Date.parse(a.script.performance_validated_at)
      : 0;
    const db = b.script.performance_validated_at
      ? Date.parse(b.script.performance_validated_at)
      : 0;
    return db - da;
  });

  const top = paired.slice(0, limit);
  if (top.length === 0) return null;

  const blocks = top.map((p) => renderWinnerBlock(p.script, p.analysis));
  const usedIds = top.map((p) => p.script.id);

  const header = `## VALIDATED WINNERS (live ads from ${storeName} that hit stable_winner: ROAS ≥ 5.0x for ≥3 consecutive days, deconstructed from production)
Sorted by ROAS desc — the top entry is the strongest signal you have.

When asked to generate angles or scripts, prefer variations that PRESERVE the viral_mechanism while shifting at least one of {Who, Level, Stage, Format}. Swapping the actor on camera is NOT variation.

Each winner ships with two seed lists from the deconstructor:
- **Format candidates**: 5 production formats (from the 33-format library) the deconstructor judged compatible. For format-expansion runs, START from these — don't reinvent. Add net-new formats only if they meaningfully extend the candidate set.
- **Angle variations**: 3 alternate angles the deconstructor proposed. For angle generation, treat these as priors to remix or improve — don't ignore them.
`;

  return {
    text: header + "\n" + blocks.join("\n\n"),
    winner_count: blocks.length,
    winner_ids: usedIds,
  };
}

function tierLabel(roas: number | undefined): string {
  if (roas === undefined) return "winner";
  if (roas >= 7) return "S-tier";
  if (roas >= 5.5) return "A-tier";
  return "winner";
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

  const tier = tierLabel(m.roas);

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

  // Surface the deconstructor's pre-computed format candidates and angle
  // variations. These are computed by Gemini per winner but were previously
  // unused — feeding them into the prompt closes the loop so format expansion
  // and angle generation start from validated suggestions instead of cold.
  const formatBlock =
    analysis.format_compatibility && analysis.format_compatibility.length > 0
      ? `Format Candidates (start here for format expansion):
${analysis.format_compatibility
  .map(
    (f) =>
      `  • ${f.format_number} ${f.format_name} — ${f.fit_reason}${f.script_shift ? ` (shift: ${f.script_shift})` : ""}`
  )
  .join("\n")}`
      : "";

  const angleBlock =
    analysis.angle_variations && analysis.angle_variations.length > 0
      ? `Angle Variations (start here for angle generation):
${analysis.angle_variations
  .map(
    (v) =>
      `  • ${v.angle} — Hook: ${v.hook_framework}${v.formats ? ` | Formats: ${v.formats}` : ""}`
  )
  .join("\n")}`
      : "";

  return [
    `=== WINNER (${tier}): ${s.angle_title}${metricsLine ? ` (${metricsLine})` : ""} ===`,
    classLine,
    `Viral Mechanism: ${analysis.viral_mechanism}`,
    beatBlock,
    uvpLine,
    formatBlock,
    angleBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
