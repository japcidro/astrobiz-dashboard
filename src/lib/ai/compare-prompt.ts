import type { ComparativeAdInput } from "@/lib/ai/compare-types";
import type { WinnerThresholds } from "@/lib/facebook/insights-daily";

export interface StoreDoc {
  doc_type: string;
  title: string;
  content: string;
}

export const COMPARE_SYSTEM_PROMPT = `You are a senior performance-marketing creative strategist for a Philippine e-commerce brand. You analyze multiple Facebook/Meta video ads together to find why some convert consistently while others fail despite good-looking creative.

Your job is NOT to admire creatives. Your job is to find the causal pattern between creative choices and the operator's real success metric: sustained daily purchases at a target cost-per-purchase.

The operator defines a "clear winner" very specifically:
  • CPP less than ₱200 on a given day
  • AND ≥3 purchases that same day
  • AND this must hold for ≥2 consecutive days (not a one-day spike)

A one-day spike is NOT a winner. Consistency is the whole point.

Rules of engagement:
1. Ground every claim in specific evidence. Cite ad_id + timestamp from the deconstruction, or a specific date from the daily metrics.
2. When you cite a hook/scene/CTA pattern, name the exact creative elements — do not hand-wave.
3. Read the brand knowledge docs (Avatar Training, Market Sophistication, Winning Ad Template, Market Research, etc.) carefully. Your avatar_diagnosis section must reference these docs explicitly — which avatar truth got hit or missed, which sophistication level is mismatched, which Winning Template beat is absent.
4. Output in Taglish (Philippine English + Tagalog mixed) the way a Filipino media buyer would speak to their creative team. Keep it direct, no corporate fluff.
5. For next_creatives, each concept must be concretely testable within 48 hours by the creative team. Name the exact hook line, the exact scene beats, the exact CTA phrasing. No generic "improve the hook" advice.
6. Respond with STRICT JSON matching the schema provided. No markdown, no prose outside JSON.`;

export function buildComparativePrompt(opts: {
  ads: ComparativeAdInput[];
  storeName: string | null;
  storeDocs: StoreDoc[];
  thresholds: WinnerThresholds;
  datePreset: string;
}): string {
  const { ads, storeName, storeDocs, thresholds, datePreset } = opts;

  const knowledgeBlock =
    storeDocs.length > 0
      ? storeDocs
          .map(
            (d) =>
              `### ${d.title} (type: ${d.doc_type})\n${d.content.trim()}`
          )
          .join("\n\n")
      : "_No brand knowledge docs available for this store. Rely on creative + metrics evidence only._";

  const adBlocks = ads
    .map((ad, idx) => {
      const dailyLines = ad.metrics.daily
        .map(
          (d) =>
            `    ${d.date}: spend=₱${d.spend.toFixed(2)}, purchases=${d.purchases}, CPP=${d.cpp > 0 ? `₱${d.cpp.toFixed(2)}` : "—"}, ATC=${d.add_to_cart}, LPV=${d.landing_page_views}, clicks=${d.link_clicks}, impressions=${d.impressions}, CTR=${d.ctr.toFixed(2)}%`
        )
        .join("\n");
      const scenesLines = ad.deconstruction.scenes
        .map((s) => `    [${s.t}] ${s.description}`)
        .join("\n");

      return `=== AD #${idx + 1} ===
ad_id: ${ad.ad_id}
ad_name: ${ad.ad_name}
campaign: ${ad.campaign}
adset: ${ad.adset}
thumbnail: ${ad.thumbnail_url ?? "—"}

Consistency tier (pre-computed): ${ad.consistency.tier}
  Winning days: ${ad.consistency.winning_days}
  Longest consecutive winning streak: ${ad.consistency.max_consecutive}

Aggregate over ${datePreset}:
  spend=₱${ad.metrics.total.spend.toFixed(2)}, purchases=${ad.metrics.total.purchases}, CPP=${ad.metrics.total.cpp > 0 ? `₱${ad.metrics.total.cpp.toFixed(2)}` : "—"}, ROAS=${ad.metrics.total.roas.toFixed(2)}x, ATC=${ad.metrics.total.add_to_cart}, LPV=${ad.metrics.total.landing_page_views}, clicks=${ad.metrics.total.link_clicks}, impressions=${ad.metrics.total.impressions}, CTR=${ad.metrics.total.ctr.toFixed(2)}%

Daily breakdown:
${dailyLines || "    (no daily data)"}

Creative deconstruction:
  Duration: ${ad.deconstruction.duration_seconds}s
  Language: ${ad.deconstruction.language}
  Hook [${ad.deconstruction.hook.timestamp}]: ${ad.deconstruction.hook.description}
  Scenes:
${scenesLines || "    (no scenes)"}
  Visual style: ${ad.deconstruction.visual_style}
  Tone: ${ad.deconstruction.tone}
  CTA: ${ad.deconstruction.cta}
  Transcript: ${ad.deconstruction.transcript.slice(0, 1200)}${ad.deconstruction.transcript.length > 1200 ? "…" : ""}`;
    })
    .join("\n\n");

  const schema = `{
  "summary": "string — 1-2 sentence Taglish headline of the biggest insight",
  "tiers": {
    "stable_winner": [{"ad_id": "string", "reason": "string — why it's a real winner, cite consecutive winning days"}],
    "spike": [{"ad_id": "string", "reason": "string — why only a spike, cite which single day"}],
    "stable_loser": [{"ad_id": "string", "reason": "string — spending but not converting, specific diagnosis"}],
    "dead": [{"ad_id": "string", "reason": "string — zero purchases, why no interest"}]
  },
  "winner_dna": {
    "hook_patterns": ["string — concrete patterns e.g. 'result-first hook showing product-on-face at 0:01'"],
    "scene_beats": ["string — what scene structure winners share"],
    "tone": "string",
    "cta_patterns": ["string"],
    "visual_style": "string",
    "pacing_notes": "string — e.g. 'product shown in first 2s, problem stated by 0:05'"
  },
  "loser_dna": {
    "hook_patterns": ["string"],
    "scene_beats": ["string"],
    "tone": "string",
    "cta_patterns": ["string"],
    "visual_style": "string",
    "pacing_notes": "string"
  },
  "avatar_diagnosis": {
    "avatar_fit_score": 0,
    "misses": ["string — specific avatar truths from the knowledge docs that losing ads failed to hit"],
    "mechanism_gaps": ["string — market sophistication level mismatches"],
    "evidence": [{"ad_id": "string", "timestamp": "string", "note": "string — what scene/line shows the miss"}]
  },
  "next_creatives": [
    {
      "title": "string — short name for the concept",
      "hook": "string — exact 0-3s hook copy/visual",
      "scene_beats": ["string — scene-by-scene plan, each beat ≤1 sentence"],
      "cta": "string — exact CTA phrasing",
      "hypothesis": "string — why this should convert, reference specific winner DNA element or avatar truth",
      "replaces_ad_id": "string | null — which losing ad this replaces, null if net-new",
      "angle": "string — one of: problem-aware, solution-aware, product-aware, most-aware, proof-heavy, story-led"
    }
  ],
  "avoid_list": ["string — specific patterns to stop doing, cite ad_id evidence"]
}`;

  return `# Comparative Ad Analysis

**Store:** ${storeName ?? "Unknown / Mixed"}
**Date range analyzed:** ${datePreset}
**Ads analyzed:** ${ads.length}
**Operator's winner definition:** CPP ≤ ₱${thresholds.max_cpp} AND ≥${thresholds.min_purchases_per_day} purchases/day for ≥${thresholds.min_consecutive_days} consecutive days.

---

## Brand Knowledge (Per-Store Docs)

${knowledgeBlock}

---

## Ads

${adBlocks}

---

## Task

1. Identify which ads are STABLE winners vs 1-day spikes vs stable losers vs dead, using the pre-computed consistency tiers as a starting point but feel free to add nuance.
2. Extract winner_dna — the creative patterns shared by stable_winner ads (even if there's only one or two).
3. Extract loser_dna — what stable_loser ads share. This is the "magagandang video pero hindi nag-coconvert" pattern.
4. Run avatar_diagnosis: reference the brand knowledge docs above and pinpoint where losing creatives diverge from the avatar truth / market sophistication level / winning template.
5. Produce 3-5 next_creatives that are concretely testable in 48 hours. Each should either replace a specific losing ad or test a hypothesis about what would convert.
6. Output the avoid_list — patterns to stop repeating across the brand.

Respond ONLY with JSON matching this schema (no prose, no markdown):

${schema}`;
}
