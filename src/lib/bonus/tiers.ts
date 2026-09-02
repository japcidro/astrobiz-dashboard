import type { BonusTier, BonusTierProgress } from "./types";

/** Sort ascending by threshold and drop anything switched off. */
export function activeTiersAscending(tiers: BonusTier[]): BonusTier[] {
  return tiers
    .filter((t) => t.is_active)
    .sort((a, b) => a.parcel_threshold - b.parcel_threshold);
}

/** Highest tier the given daily average has already cleared. */
export function tierForAverage(
  average: number,
  tiers: BonusTier[]
): BonusTier | null {
  const sorted = activeTiersAscending(tiers);
  let hit: BonusTier | null = null;
  for (const tier of sorted) {
    if (average >= tier.parcel_threshold) hit = tier;
    else break;
  }
  return hit;
}

/**
 * Where the company stands against the tier ladder.
 *
 * The gap to the next tier is expressed as a daily pace rather than a
 * countdown of parcels: the headline average is a rolling 15-day window
 * while the cutoff is open, and a rolling window has no deadline to bank
 * parcels against — "12 more per day" is both true and directly actionable,
 * where "1,020 more parcels" would be measuring against a period the
 * displayed number is not scoped to.
 */
export function computeTierProgress(
  average: number,
  tiers: BonusTier[]
): BonusTierProgress {
  const sorted = activeTiersAscending(tiers);
  const current = tierForAverage(average, sorted);
  const next = sorted.find((t) => t.parcel_threshold > average) ?? null;

  if (!next) {
    return {
      current_tier: current,
      next_tier: null,
      progress_pct: sorted.length > 0 ? 100 : 0,
      to_next: null,
    };
  }

  const floor = current?.parcel_threshold ?? 0;
  const span = next.parcel_threshold - floor;
  const progress_pct =
    span > 0
      ? Math.max(0, Math.min(100, ((average - floor) / span) * 100))
      : 0;

  return {
    current_tier: current,
    next_tier: next,
    progress_pct,
    to_next: { per_day_gap: next.parcel_threshold - average },
  };
}
