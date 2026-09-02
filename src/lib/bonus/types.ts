import type { BonusPeriod } from "./period";

/**
 * A rung on the ladder. Payout amounts are not announced yet, so a tier is
 * only a threshold and a name — the dashboard marks it hit or not-yet.
 */
export interface BonusTier {
  id: string;
  parcel_threshold: number;
  label: string | null;
  is_active: boolean;
}

export interface BonusParcelStats {
  /** Parcels shipped inside the period (J&T rows by submission_date). */
  total: number;
  /** total ÷ days_elapsed — the cutoff-to-date average. */
  average_per_day: number;
  /** Where the period lands if the current pace holds to the cutoff. */
  projected_total: number;
  daily: { date: string; count: number }[];
  best_day: { date: string; count: number } | null;
  /**
   * Rolling last-N-days pace. This is the headline figure while the cutoff
   * is still open: on day 2 of a period the cutoff-to-date average is two
   * days of noise, while a 15-day window is always a full sample.
   */
  pace: {
    average_per_day: number;
    total: number;
    window_days: number;
    date_from: string;
    date_to: string;
  };
}

export interface BonusCppStats {
  /** Weighted: total ad spend ÷ total orders across the window. */
  average: number;
  ad_spend: number;
  order_count: number;
  window_days: number;
  date_from: string;
  date_to: string;
  /** Set when the P&L read failed — the card degrades instead of lying. */
  error: string | null;
}

export interface BonusRtsStats {
  /** returned ÷ (delivered + returned) — settled parcels only. */
  rate_pct: number;
  returned: number;
  delivered: number;
  settled: number;
  in_transit: number;
  total: number;
  window_days: number;
  date_from: string;
  date_to: string;
}

export interface BonusTierProgress {
  current_tier: BonusTier | null;
  next_tier: BonusTier | null;
  /** Progress toward the next tier, 0–100. 100 when the top tier is held. */
  progress_pct: number;
  /**
   * How far off the next tier is, as a daily pace. A rolling window has no
   * cutoff to count down to, so the honest statement is "X more per day",
   * not "N more parcels by the 15th". Null when there is no next tier.
   */
  to_next: { per_day_gap: number } | null;
}

export interface BonusOverview {
  period: BonusPeriod;
  parcels: BonusParcelStats;
  tiers: BonusTier[];
  /**
   * Which average the tier is judged on right now. "pace" is the rolling
   * window, used while the cutoff is still open; "cutoff" is the period's
   * own average, which takes over on the 15th / end-of-month because that
   * is the number the payout is actually settled on.
   */
  judged_on: "pace" | "cutoff";
  /** The average `judged_on` selected — what the ladder is measured against. */
  judged_average: number;
  progress: BonusTierProgress;
  cpp: BonusCppStats;
  rts: BonusRtsStats;
  previous: {
    period: BonusPeriod;
    total: number;
    average_per_day: number;
    tier: BonusTier | null;
  } | null;
  generated_at: string;
}
