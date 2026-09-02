import type { BonusPeriod } from "./period";

export interface BonusTier {
  id: string;
  parcel_threshold: number;
  bonus_amount: number;
  label: string | null;
  is_active: boolean;
}

export interface BonusParcelStats {
  /** Parcels shipped inside the period (J&T rows by submission_date). */
  total: number;
  /** total ÷ days_elapsed — the running pace the tier is judged on. */
  average_per_day: number;
  /** Where the period lands if the current pace holds to the cutoff. */
  projected_total: number;
  daily: { date: string; count: number }[];
  best_day: { date: string; count: number } | null;
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
   * What it takes to still land the next tier by the cutoff: extra parcels
   * needed overall, and the per-day pace across the days that remain.
   * Null when there is no next tier or the period has already closed.
   */
  to_next: {
    parcels_needed: number;
    per_remaining_day: number;
    days_remaining: number;
  } | null;
}

export interface BonusOverview {
  period: BonusPeriod;
  parcels: BonusParcelStats;
  tiers: BonusTier[];
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
