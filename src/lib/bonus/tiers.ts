import type { BonusPeriod } from "./period";
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
 * Where the company stands against the tier ladder, plus the pace needed
 * to still reach the next rung before the cutoff.
 *
 * The "parcels needed" figure is deliberately computed against the FULL
 * period (threshold × days_total), not against the days already elapsed —
 * the tier is judged on the period average, so a slow first week has to be
 * made up inside the days that are left.
 */
export function computeTierProgress(
  average: number,
  periodTotal: number,
  period: BonusPeriod,
  tiers: BonusTier[]
): BonusTierProgress {
  const sorted = activeTiersAscending(tiers);
  const current = tierForAverage(average, sorted);
  const next =
    sorted.find((t) => t.parcel_threshold > average) ?? null;

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

  // Once the cutoff has passed the number is settled — no pace to chase.
  if (period.days_remaining <= 0) {
    return { current_tier: current, next_tier: next, progress_pct, to_next: null };
  }

  const targetTotal = next.parcel_threshold * period.days_total;
  const parcels_needed = Math.max(0, Math.ceil(targetTotal - periodTotal));

  return {
    current_tier: current,
    next_tier: next,
    progress_pct,
    to_next: {
      parcels_needed,
      per_remaining_day: parcels_needed / period.days_remaining,
      days_remaining: period.days_remaining,
    },
  };
}
