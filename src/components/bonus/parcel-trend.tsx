"use client";

import type { BonusTier } from "@/lib/bonus/types";

interface Props {
  daily: { date: string; count: number }[];
  average: number;
  tiers: BonusTier[];
}

const CHART_HEIGHT = 140;

export function ParcelTrend({ daily, average, tiers }: Props) {
  const activeTiers = tiers
    .filter((t) => t.is_active)
    .sort((a, b) => a.parcel_threshold - b.parcel_threshold);

  const maxCount = Math.max(...daily.map((d) => d.count), 0);
  const topTier = activeTiers.at(-1)?.parcel_threshold ?? 0;

  // Headroom so the highest tier line stays on-canvas even on a slow day —
  // otherwise the target the team is chasing is invisible exactly when it
  // matters most.
  const scaleMax = Math.max(maxCount, topTier, 1) * 1.1;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-white">Daily parcels</h2>
        <span className="text-[11px] text-gray-500">
          cutoff avg{" "}
          <strong className="text-gray-300">
            {average.toLocaleString("en-PH", { maximumFractionDigits: 1 })}
          </strong>
          /day
        </span>
      </div>
      <p className="text-[11px] text-gray-500 mb-4">
        This cutoff period, by J&amp;T submission date.
      </p>

      {daily.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">
          No parcels yet in this cutoff.
        </p>
      ) : (
        <>
          <div className="relative" style={{ height: CHART_HEIGHT }}>
            {/* Tier threshold guides */}
            {activeTiers.map((tier) => {
              const pct = (tier.parcel_threshold / scaleMax) * 100;
              if (pct > 100) return null;
              const cleared = average >= tier.parcel_threshold;
              return (
                <div
                  key={tier.id}
                  className="absolute left-0 right-0 flex items-center pointer-events-none"
                  style={{ bottom: `${pct}%` }}
                >
                  <div
                    className={`flex-1 border-t border-dashed ${
                      cleared ? "border-yellow-600/50" : "border-gray-700/60"
                    }`}
                  />
                  <span
                    className={`text-[9px] pl-1 ${
                      cleared ? "text-yellow-500/80" : "text-gray-600"
                    }`}
                  >
                    {tier.parcel_threshold}
                  </span>
                </div>
              );
            })}

            {/* Bars */}
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {daily.map((d) => {
                const pct = scaleMax > 0 ? (d.count / scaleMax) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 min-w-0 group relative flex items-end"
                    style={{ height: "100%" }}
                  >
                    <div
                      className="w-full rounded-t bg-purple-500/70 group-hover:bg-purple-400 transition-colors"
                      style={{ height: `${Math.max(pct, d.count > 0 ? 2 : 0)}%` }}
                    />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-[10px] text-white z-10">
                      {d.date.slice(5)} · {d.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between text-[10px] text-gray-600 mt-1.5">
            <span>{daily[0]?.date.slice(5)}</span>
            <span>{daily.at(-1)?.date.slice(5)}</span>
          </div>
        </>
      )}
    </section>
  );
}
