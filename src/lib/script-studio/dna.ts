import type { SupabaseClient } from "@supabase/supabase-js";
import { matchAdToStore } from "@/lib/profit/store-matching";
import { WRITER_MODEL, askJson, isError } from "./claude";
import type { DnaView, DnaWinner } from "./types";

/**
 * The Winning DNA: a brief Claude writes from the brand's own deconstructed
 * video ads (ad_creative_analyses) joined to their purchases and cost per
 * purchase (the cached ads_v3 payloads, summed by script_studio_ad_metrics).
 * The adapter reads it to fill what a reference cannot give us.
 */

const MAX_ADS = 30;
const MAX_TRANSCRIPT = 2200;

interface MetricRow {
  ad_id: string;
  ad: string;
  campaign: string | null;
  adset: string | null;
  account: string | null;
  purchases: number;
  spend: number;
  revenue: number;
  impressions: number;
  created_time: string | null;
}

interface Analysis {
  transcript?: string;
  fingerprint?: string;
  duration_seconds?: number;
  language?: string;
  classification?: Record<string, unknown>;
  hook_anatomy?: Record<string, unknown>;
  beat_map?: Record<string, unknown>;
  uvp?: Record<string, unknown>;
  viral_mechanism?: string;
  cta?: string;
}

const DNA_SCHEMA = { type: "object", additionalProperties: false, required: ["dna"], properties: { dna: { type: "string" } } } as const;

const DNA_SYSTEM = `You write the Winning DNA brief for one brand's video ads: what has actually sold, read from the brand's own ads with their real purchase numbers. A scriptwriter will read it before adapting a competitor's script for this brand, to fill what that script cannot give us. Be concrete and quote real lines from the winners; never invent a line, a number or a claim.

Write plain text with exactly these headed sections, about 500 words in all:
WHAT A WINNER LOOKS LIKE: the hooks that won (quote the opening lines with their purchases and cost per purchase), length, language mix and where Tagalog vs English lands, tone, the kind of proof that worked.
THE SPINE: the beats every winner runs, in order, with the actual lines used for each beat (quote them).
WHAT LOST: the hooks and shapes with the worst cost per purchase and what they did differently.
COMPLIANCE WORDING: the phrasing the newer winners use for the mechanism and results, and what to avoid.
BRAND FACTS: the product facts that appear in the winning ads (name, what it is, dose, offer, guarantee, proof), only as the ads state them.

Answer with JSON only: {"dna": "<the brief>"}.`;

const cleanTranscript = (t: string) => t.replace(/\b\d{1,2}:\d{2}\b/g, "").replace(/\s+/g, " ").trim();
const hookOf = (t: string) => cleanTranscript(t).replace(/\[ON-SCREEN:[^\]]*\]/g, "").trim().slice(0, 140);

/** Rebuild the brief for a brand from its data; returns the saved view. */
export async function buildDna(db: SupabaseClient, store: string, builtBy: string | null): Promise<DnaView | { error: string }> {
  const [{ data: metricRows, error: mErr }, { data: analysisRows }] = await Promise.all([
    db.rpc("script_studio_ad_metrics"),
    db.from("ad_creative_analyses").select("ad_id, analysis, created_at"),
  ]);
  if (mErr) return { error: `Could not read the ad metrics: ${mErr.message}` };
  const upper = store.trim().toUpperCase();
  const metrics = new Map<string, MetricRow>();
  for (const r of (metricRows ?? []) as MetricRow[]) {
    if (matchAdToStore(r.campaign ?? "", r.adset ?? "", r.account ?? "") !== upper) continue;
    metrics.set(r.ad_id, { ...r, purchases: Number(r.purchases) || 0, spend: Number(r.spend) || 0, revenue: Number(r.revenue) || 0, impressions: Number(r.impressions) || 0 });
  }
  const analyzed = ((analysisRows ?? []) as Array<{ ad_id: string; analysis: Analysis; created_at: string }>).filter((a) => metrics.has(a.ad_id));
  if (analyzed.length === 0) return { error: `No deconstructed ads with metrics for ${store} yet. The nightly cron deconstructs the top ads; the Ad Performance page has to have viewed the weeks the ads ran.` };

  const all = [...metrics.values()];
  const spend = all.reduce((s, r) => s + r.spend, 0);
  const buys = all.reduce((s, r) => s + r.purchases, 0);
  const blended = buys > 0 ? spend / buys : null;
  const verdict = (r: MetricRow): DnaWinner["verdict"] => {
    const cpa = r.purchases > 0 ? r.spend / r.purchases : null;
    if (!blended || cpa === null) return r.spend >= 1500 ? "loser" : "middle";
    if (cpa <= blended * 0.95 && r.purchases >= 10) return "winner";
    if (cpa >= blended * 1.2 && r.spend >= 1500) return "loser";
    return "middle";
  };
  const picked = analyzed
    .map((a) => ({ a, m: metrics.get(a.ad_id)! }))
    .sort((x, y) => y.m.purchases - x.m.purchases || y.m.spend - x.m.spend)
    .slice(0, MAX_ADS);
  const winners: DnaWinner[] = picked.map(({ a, m }) => ({
    ad_id: m.ad_id,
    ad: m.ad,
    purchases: m.purchases,
    spend: Math.round(m.spend),
    cpa: m.purchases > 0 ? Math.round(m.spend / m.purchases) : null,
    verdict: verdict(m),
    hook: hookOf(a.analysis.transcript ?? ""),
    transcript: cleanTranscript(a.analysis.transcript ?? "").slice(0, 6000),
    seconds: typeof a.analysis.duration_seconds === "number" ? a.analysis.duration_seconds : null,
  }));

  const blocks = picked.map(({ a, m }, i) => {
    const w = winners[i];
    const x = a.analysis;
    return [
      `AD ${i + 1}: ${m.ad} · ${w.verdict.toUpperCase()} · ${m.purchases} purchases · ₱${Math.round(m.spend)} spend · ${w.cpa === null ? "no purchases" : `₱${w.cpa} per purchase`} · ${w.seconds ?? "?"} s · ${x.language ?? ""}`,
      x.fingerprint ? `Fingerprint: ${x.fingerprint}` : "",
      x.classification ? `Classification: ${JSON.stringify(x.classification)}` : "",
      x.hook_anatomy ? `Hook anatomy: ${JSON.stringify(x.hook_anatomy)}` : "",
      x.beat_map ? `Beat map: ${JSON.stringify(x.beat_map).slice(0, 1500)}` : "",
      x.uvp ? `UVP: ${JSON.stringify(x.uvp).slice(0, 800)}` : "",
      `Transcript: ${w.transcript.slice(0, MAX_TRANSCRIPT)}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const user = [
    `Brand: ${store}. ${all.length} ads with metrics, ₱${Math.round(spend)} spend, ${buys} purchases${blended ? `, blended ₱${Math.round(blended)} per purchase` : ""}. Winner = at most 95% of the blended cost per purchase with 10+ purchases; loser = 120% or more with ₱1,500+ spend.`,
    `${picked.length} deconstructed ads, most purchases first:\n\n${blocks.join("\n\n")}`,
    "Write the Winning DNA brief. Answer with JSON only.",
  ].join("\n\n");
  const out = await askJson<{ dna: string }>(db, { model: WRITER_MODEL, system: DNA_SYSTEM, user, schema: DNA_SCHEMA as unknown as Record<string, unknown>, maxTokens: 8000, effort: "high" });
  if (isError(out)) return out;
  const dna = String(out.dna ?? "").trim().slice(0, 12000);
  if (dna.length < 200) return { error: "Claude's brief came back empty" };
  const built_at = new Date().toISOString();
  const { error } = await db.from("script_brand_dna").upsert({ store, dna, built_from: winners, built_at, built_by: builtBy }, { onConflict: "store" });
  if (error) return { error: error.message };
  return toDnaView({ store, dna, built_from: winners, built_at });
}

export function toDnaView(row: { store: string; dna: string; built_from: unknown; built_at: string }): DnaView {
  const from = (Array.isArray(row.built_from) ? row.built_from : []) as DnaWinner[];
  return {
    store: row.store,
    dna: row.dna,
    built_at: row.built_at,
    ads_read: from.length,
    winners: from.filter((w) => w.verdict === "winner" && w.transcript).slice(0, 8),
  };
}
