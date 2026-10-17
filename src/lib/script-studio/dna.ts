import type { SupabaseClient } from "@supabase/supabase-js";
import { WRITER_MODEL, askJson, isError } from "./claude";
import type { DnaView, Winner } from "./types";
import { DEFAULT_ANCHOR_DAYS, isRecent } from "./types";
import { refreshWinners, transcribeWinner } from "./winners";

/**
 * The Winning DNA: a brief Claude writes from the brand's own deconstructed
 * ads and their purchases, anchored on the ads launched inside the anchor
 * window (what is winning now); older winners are background. The adapter
 * reads it to fill what a reference cannot give us.
 */

const MAX_ADS = 30;
const MAX_TRANSCRIPT = 2200;
/** Recent winners deconstructed on the fly before the brief is written; more go through the list's Transcribe button. */
const MAX_TRANSCRIBE_ON_REBUILD = 2;

interface Analysis {
  transcript?: string;
  fingerprint?: string;
  duration_seconds?: number;
  language?: string;
  classification?: Record<string, unknown>;
  hook_anatomy?: Record<string, unknown>;
  beat_map?: Record<string, unknown>;
  uvp?: Record<string, unknown>;
}

const DNA_SCHEMA = { type: "object", additionalProperties: false, required: ["dna"], properties: { dna: { type: "string" } } } as const;

const DNA_SYSTEM = `You write the Winning DNA brief for one brand's video ads: what has actually sold, read from the brand's own ads with their real purchase numbers. A scriptwriter will read it before adapting a competitor's script for this brand, to fill what that script cannot give us, and to make the next scripts win the way the current winners win. Be concrete and quote real lines from the transcripts; never invent a line, a number or a claim.

The ads come in two groups. WINNING NOW: launched inside the anchor window; they carry the weight, and the first section is about them. EARLIER: older winners and losers; background, kept only for what still holds. An ad marked EARLY is new, has little spend and a strong cost per purchase: read it as a signal of where the winning is going, and say that its numbers are early. A creative's purchases and spend include its scaled copies.

Write plain text with exactly these headed sections, about 600 words in all:
WHAT IS WINNING NOW: for each current winner, its name, purchases and cost per purchase; the format (a skit, a talking head, an expert, an update, a voice-over…), who is on screen, the hook move; then, across them: why they win, and how the script is built beat by beat with the actual lines (quote them); the lines and devices to reuse in the next scripts.
STILL TRUE FROM EARLIER WINNERS: the beats, lines and proof that the earlier winners share and the current ones keep (quote them), and anything the current winners dropped.
WHAT LOST: the hooks and shapes with the worst cost per purchase and what they did differently.
COMPLIANCE WORDING: the phrasing the newest winners use for the mechanism and results, and what to avoid.
BRAND FACTS: the product facts that appear in the winning ads (name, what it is, dose, offer, guarantee, proof), only as the ads state them.

When a current winner has no transcript yet, say so in WHAT IS WINNING NOW with its numbers and format unknown, and do not guess its lines.

Answer with JSON only: {"dna": "<the brief>"}.`;

async function dnaRow(db: SupabaseClient, store: string) {
  const { data } = await db.from("script_brand_dna").select("store, dna, built_from, built_at, marketer_brief, anchor_days").eq("store", store).maybeSingle();
  return data as { store: string; dna: string; built_from: unknown; built_at: string; marketer_brief: string | null; anchor_days: number | null } | null;
}

/** Rebuild the brief for a brand from its data; returns the saved view. */
export async function buildDna(db: SupabaseClient, store: string, builtBy: string | null): Promise<DnaView | { error: string }> {
  const existing = await dnaRow(db, store);
  const anchorDays = existing?.anchor_days ?? DEFAULT_ANCHOR_DAYS;
  let view = await refreshWinners(db, store, true);
  if ("error" in view) return view;
  // The newest winners first: deconstruct the ones the cron never reached, a couple per rebuild.
  const missing = view.winners.filter((w) => isRecent(w.created_time, anchorDays) && !w.transcript && w.verdict !== "loser").sort((a, b) => b.purchases - a.purchases).slice(0, MAX_TRANSCRIBE_ON_REBUILD);
  for (const w of missing) {
    const r = await transcribeWinner(db, store, w.ad_id);
    if (!("error" in r)) view = r;
  }
  const withText = view.winners.filter((w) => w.transcript);
  if (withText.length === 0) return { error: `No deconstructed ads for ${store} yet. Transcribe a winner from the list first.` };

  const { data: analysisRows } = await db.from("ad_creative_analyses").select("ad_id, analysis").in("ad_id", withText.map((w) => w.ad_id));
  const analyses = new Map(((analysisRows ?? []) as Array<{ ad_id: string; analysis: Analysis }>).map((a) => [a.ad_id, a.analysis]));
  const now = view.winners.filter((w) => isRecent(w.created_time, anchorDays));
  const earlier = view.winners.filter((w) => !isRecent(w.created_time, anchorDays) && w.transcript).slice(0, MAX_ADS - now.length);
  const block = (w: Winner, i: number) => {
    const x = analyses.get(w.ad_id);
    const launched = w.created_time ? w.created_time.slice(0, 10) : "unknown date";
    return [
      `AD ${i + 1}: ${w.ad} · ${w.verdict.toUpperCase()} · launched ${launched} · ${w.purchases} purchases · ₱${w.spend} spend · ${w.cpa === null ? "no purchases" : `₱${w.cpa} per purchase`} · ${w.seconds ?? "?"} s${x?.language ? ` · ${x.language}` : ""}`,
      x?.fingerprint ? `Fingerprint: ${x.fingerprint}` : "",
      x?.classification ? `Classification: ${JSON.stringify(x.classification)}` : "",
      x?.hook_anatomy ? `Hook anatomy: ${JSON.stringify(x.hook_anatomy)}` : "",
      x?.beat_map ? `Beat map: ${JSON.stringify(x.beat_map).slice(0, 1500)}` : "",
      x?.uvp ? `UVP: ${JSON.stringify(x.uvp).slice(0, 800)}` : "",
      w.transcript ? `Transcript: ${w.transcript.slice(0, MAX_TRANSCRIPT)}` : "Transcript: not available yet.",
    ]
      .filter(Boolean)
      .join("\n");
  };
  const metrics = view.winners;
  const spend = metrics.reduce((s, r) => s + r.spend, 0);
  const buys = metrics.reduce((s, r) => s + r.purchases, 0);
  const user = [
    `Brand: ${store}. Anchor window: the last ${anchorDays} days. Across the ${metrics.length} ads that sold: ₱${spend} spend, ${buys} purchases. Winner = at most 95% of the brand's blended cost per purchase with 10+ purchases; early = launched in the window at 90% of blended or better, however little it has spent; loser = 120% or more with ₱1,500+ spend.`,
    `WINNING NOW (${now.length} ads launched in the last ${anchorDays} days, most purchases first):\n\n${now.length ? now.sort((a, b) => b.purchases - a.purchases).map(block).join("\n\n") : "(none launched in the window)"}`,
    `EARLIER (${earlier.length} deconstructed ads, background):\n\n${earlier.sort((a, b) => b.purchases - a.purchases).map((w, i) => block(w, now.length + i)).join("\n\n")}`,
    "Write the Winning DNA brief. Answer with JSON only.",
  ].join("\n\n");
  const out = await askJson<{ dna: string }>(db, { model: WRITER_MODEL, system: DNA_SYSTEM, user, schema: DNA_SCHEMA as unknown as Record<string, unknown>, maxTokens: 10000, effort: "high" });
  if (isError(out)) return out;
  const dna = String(out.dna ?? "").trim().slice(0, 14000);
  if (dna.length < 200) return { error: "Claude's brief came back empty" };
  const built_at = new Date().toISOString();
  const built_from = [...now, ...earlier].map((w) => ({ ad_id: w.ad_id, ad: w.ad, created_time: w.created_time, purchases: w.purchases, cpa: w.cpa, verdict: w.verdict, has_transcript: !!w.transcript }));
  const { error } = await db.from("script_brand_dna").upsert({ store, dna, built_from, built_at, built_by: builtBy, anchor_days: anchorDays }, { onConflict: "store" });
  if (error) return { error: error.message };
  return toDnaView({ store, dna, built_from, built_at, marketer_brief: existing?.marketer_brief ?? "", anchor_days: anchorDays });
}

/** The marketer's standing brief, kept on the brand's DNA row (made when missing). */
export async function saveBrief(db: SupabaseClient, store: string, brief: string): Promise<DnaView | { error: string }> {
  const existing = await dnaRow(db, store);
  const row = { store, dna: existing?.dna ?? "", built_from: existing?.built_from ?? [], built_at: existing?.built_at ?? new Date().toISOString(), marketer_brief: brief, anchor_days: existing?.anchor_days ?? DEFAULT_ANCHOR_DAYS };
  const { error } = await db.from("script_brand_dna").upsert(row, { onConflict: "store" });
  if (error) return { error: error.message };
  return toDnaView(row);
}

export function toDnaView(row: { store: string; dna: string; built_from: unknown; built_at: string; marketer_brief?: string | null; anchor_days?: number | null }): DnaView {
  const from = (Array.isArray(row.built_from) ? row.built_from : []) as Array<{ created_time?: string | null }>;
  const anchor = row.anchor_days ?? DEFAULT_ANCHOR_DAYS;
  return {
    store: row.store,
    dna: row.dna,
    built_at: row.built_at,
    ads_read: from.length,
    winning_now: from.filter((w) => isRecent(w.created_time ?? null, anchor)).length,
    anchor_days: anchor,
    brief: row.marketer_brief ?? "",
  };
}
