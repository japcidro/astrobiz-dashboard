"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Trophy,
  Zap,
  TrendingDown,
  CircleSlash,
  Target,
  Brain,
  Sparkles,
  AlertTriangle,
  Wand2,
  ArrowUpRight,
} from "lucide-react";
import type { ComparativeReport } from "@/lib/ai/compare-types";

interface AdSummary {
  ad_id: string;
  ad_name: string;
  thumbnail_url: string | null;
  consistency: { tier: string; winning_days: number; max_consecutive: number };
  metrics_total: {
    spend: number;
    purchases: number;
    cpp: number;
    roas: number;
  };
  daily: Array<{
    date: string;
    spend: number;
    purchases: number;
    cpp: number;
  }>;
}

interface InputsSnapshot {
  ads: AdSummary[];
  date_preset: string;
  thresholds: {
    max_cpp: number;
    min_purchases_per_day: number;
    min_consecutive_days: number;
    min_roas: number;
  };
  store_docs: Array<{ doc_type: string; title: string }>;
}

interface Props {
  report: ComparativeReport;
  inputsSnapshot: InputsSnapshot | null;
  storeName: string | null;
  onClose?: () => void;
}

const TIER_META: Record<
  "stable_winner" | "spike" | "stable_loser" | "dead",
  { label: string; color: string; icon: typeof Trophy }
> = {
  stable_winner: {
    label: "Stable Winners",
    color: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40",
    icon: Trophy,
  },
  spike: {
    label: "1-Day Spikes",
    color: "text-yellow-400 bg-yellow-900/30 border-yellow-700/40",
    icon: Zap,
  },
  stable_loser: {
    label: "Stable Losers",
    color: "text-orange-400 bg-orange-900/30 border-orange-700/40",
    icon: TrendingDown,
  },
  dead: {
    label: "Dead",
    color: "text-gray-400 bg-gray-800/50 border-gray-700/40",
    icon: CircleSlash,
  },
};

function money(n: number): string {
  if (n >= 1000) return `₱${(n / 1000).toFixed(1)}k`;
  return `₱${Math.round(n)}`;
}

function buildScriptHandoffUrl(opts: {
  storeName: string | null;
  concept: ComparativeReport["next_creatives"][number];
}): string {
  const { storeName, concept } = opts;
  const beats = concept.scene_beats
    .map((b, i) => `${i + 1}. ${b}`)
    .join("\n");
  const promptText = `Gawan mo ako ng buong script para sa creative na ito:

Title: ${concept.title}
Angle: ${concept.angle}

Hook (0-3s): ${concept.hook}

Scene beats:
${beats}

CTA: ${concept.cta}

Why this should convert: ${concept.hypothesis}

Bigyan mo ako ng full script (voiceover + on-screen text + scene direction) na pwede agad ipa-shoot. Taglish, conversational, fits the brand voice from the knowledge docs.`;

  const params = new URLSearchParams();
  if (storeName) params.set("store", storeName);
  params.set("tool", "scripts");
  params.set("prompt", promptText);
  return `/marketing/ai-generator?${params.toString()}`;
}

export function ComparativeReportView({
  report,
  inputsSnapshot,
  storeName,
}: Props) {
  const adById = useMemo(() => {
    const m = new Map<string, AdSummary>();
    for (const a of inputsSnapshot?.ads ?? []) m.set(a.ad_id, a);
    return m;
  }, [inputsSnapshot]);

  const tiers = report.tiers;

  const renderAdChip = (ad_id: string, reason: string) => {
    const ad = adById.get(ad_id);
    return (
      <div
        key={ad_id}
        className="flex items-start gap-3 p-3 bg-gray-900/50 border border-gray-700/40 rounded-lg"
      >
        {ad?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.thumbnail_url}
            alt=""
            className="w-12 h-12 rounded border border-gray-700 object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded bg-gray-800 border border-gray-700 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white font-medium truncate">
            {ad?.ad_name ?? ad_id}
          </p>
          {ad && (
            <p className="text-xs text-gray-500 mt-0.5">
              {ad.metrics_total.purchases} purchases · CPP{" "}
              {ad.metrics_total.cpp > 0 ? money(ad.metrics_total.cpp) : "—"} ·
              ROAS {ad.metrics_total.roas.toFixed(2)}x · winning days{" "}
              {ad.consistency.winning_days} (streak{" "}
              {ad.consistency.max_consecutive})
            </p>
          )}
          <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{reason}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/20 border border-emerald-700/40 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg flex-shrink-0">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-white mb-1">
              Comparative Analysis
              {storeName && (
                <span className="text-sm text-gray-400 font-normal ml-2">
                  · {storeName}
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-200 leading-relaxed">
              {report.summary}
            </p>
            {inputsSnapshot && (
              <p className="text-xs text-gray-500 mt-2">
                Range: {inputsSnapshot.date_preset} · {inputsSnapshot.ads.length}{" "}
                ads · Winner threshold: ROAS ≥{" "}
                {inputsSnapshot.thresholds.min_roas.toFixed(1)}x ×{" "}
                {inputsSnapshot.thresholds.min_consecutive_days} consecutive days
                {inputsSnapshot.store_docs.length > 0 && (
                  <span>
                    {" "}
                    · {inputsSnapshot.store_docs.length} brand docs applied
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Consistency tiers */}
      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Target size={14} />
          Consistency Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            ["stable_winner", "spike", "stable_loser", "dead"] as const
          ).map((tier) => {
            const items = tiers[tier] ?? [];
            const meta = TIER_META[tier];
            const Icon = meta.icon;
            return (
              <div
                key={tier}
                className={`border rounded-xl p-3 ${meta.color}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} />
                  <h4 className="text-sm font-semibold">
                    {meta.label} ({items.length})
                  </h4>
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">None.</p>
                  ) : (
                    items.map((it) => renderAdChip(it.ad_id, it.reason))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* DNA comparison */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-emerald-900/15 border border-emerald-700/30 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-emerald-300 mb-3 flex items-center gap-2">
            <Trophy size={14} />
            Winner DNA
          </h4>
          <DnaBlock dna={report.winner_dna} />
        </div>
        <div className="bg-orange-900/15 border border-orange-700/30 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-orange-300 mb-3 flex items-center gap-2">
            <TrendingDown size={14} />
            Loser DNA
          </h4>
          <DnaBlock dna={report.loser_dna} />
        </div>
      </section>

      {/* Avatar diagnosis */}
      <section className="bg-purple-900/15 border border-purple-700/30 rounded-xl p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 bg-purple-600/20 rounded-lg flex-shrink-0">
            <Brain size={16} className="text-purple-400" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-purple-300">
              Avatar-Level Diagnosis
            </h4>
            <p className="text-xs text-gray-400 mt-0.5">
              Avatar fit score:{" "}
              <span className="text-white font-semibold">
                {report.avatar_diagnosis.avatar_fit_score}/100
              </span>
            </p>
          </div>
        </div>

        {report.avatar_diagnosis.misses.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-purple-200 mb-1.5">
              Avatar truths missed:
            </p>
            <ul className="space-y-1">
              {report.avatar_diagnosis.misses.map((m, i) => (
                <li
                  key={i}
                  className="text-sm text-gray-200 leading-relaxed pl-3 border-l border-purple-700/40"
                >
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.avatar_diagnosis.mechanism_gaps.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-purple-200 mb-1.5">
              Market sophistication / mechanism gaps:
            </p>
            <ul className="space-y-1">
              {report.avatar_diagnosis.mechanism_gaps.map((g, i) => (
                <li
                  key={i}
                  className="text-sm text-gray-200 leading-relaxed pl-3 border-l border-purple-700/40"
                >
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.avatar_diagnosis.evidence.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-purple-200 mb-1.5">
              Evidence:
            </p>
            <ul className="space-y-1">
              {report.avatar_diagnosis.evidence.map((e, i) => {
                const ad = adById.get(e.ad_id);
                return (
                  <li key={i} className="text-xs text-gray-400">
                    <span className="text-purple-300 font-medium">
                      {ad?.ad_name ?? e.ad_id}
                    </span>{" "}
                    @ {e.timestamp} — {e.note}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Next creatives */}
      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Wand2 size={14} />
          Next Creatives to Test ({report.next_creatives.length})
        </h3>
        <div className="space-y-3">
          {report.next_creatives.map((c, i) => {
            const replacesAd = c.replaces_ad_id
              ? adById.get(c.replaces_ad_id)
              : null;
            return (
              <div
                key={i}
                className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-white">
                      {i + 1}. {c.title}
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Angle: <span className="text-blue-300">{c.angle}</span>
                      {replacesAd && (
                        <>
                          {" · Replaces: "}
                          <span className="text-orange-300">
                            {replacesAd.ad_name}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <Link
                    href={buildScriptHandoffUrl({
                      storeName,
                      concept: c,
                    })}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                  >
                    <ArrowUpRight size={12} />
                    Generate full script
                  </Link>
                </div>

                <div className="space-y-2.5 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      Hook (0-3s)
                    </p>
                    <p className="text-gray-200 leading-relaxed">{c.hook}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      Scene beats
                    </p>
                    <ol className="text-gray-200 leading-relaxed space-y-1 pl-4 list-decimal">
                      {c.scene_beats.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      CTA
                    </p>
                    <p className="text-gray-200 leading-relaxed">{c.cta}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      Why this should convert
                    </p>
                    <p className="text-gray-300 leading-relaxed italic">
                      {c.hypothesis}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Avoid list */}
      {report.avoid_list.length > 0 && (
        <section className="bg-red-900/15 border border-red-700/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2">
            <AlertTriangle size={14} />
            Do Not Repeat
          </h3>
          <ul className="space-y-1.5">
            {report.avoid_list.map((a, i) => (
              <li
                key={i}
                className="text-sm text-gray-200 leading-relaxed pl-3 border-l border-red-700/40"
              >
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DnaBlock({ dna }: { dna: ComparativeReport["winner_dna"] }) {
  return (
    <div className="space-y-3 text-sm">
      <DnaList label="Hook patterns" items={dna.hook_patterns} />
      <DnaList label="Scene beats" items={dna.scene_beats} />
      <DnaList label="CTA patterns" items={dna.cta_patterns} />
      <DnaItem label="Tone" value={dna.tone} />
      <DnaItem label="Visual style" value={dna.visual_style} />
      <DnaItem label="Pacing" value={dna.pacing_notes} />
    </div>
  );
}

function DnaList({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </p>
      <ul className="space-y-1 pl-3">
        {items.map((it, i) => (
          <li
            key={i}
            className="text-gray-200 text-sm leading-relaxed list-disc list-inside"
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DnaItem({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </p>
      <p className="text-gray-200 leading-relaxed">{value}</p>
    </div>
  );
}
