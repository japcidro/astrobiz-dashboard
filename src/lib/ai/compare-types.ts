import type { ConsistencyTier, DailyAdMetrics } from "@/lib/facebook/insights-daily";

export interface AdDeconstruction {
  transcript: string;
  hook: {
    description: string;
    timestamp: string;
  };
  scenes: Array<{
    t: string;
    description: string;
  }>;
  visual_style: string;
  tone: string;
  cta: string;
  language: string;
  duration_seconds: number;
}

export interface ComparativeAdInput {
  ad_id: string;
  ad_name: string;
  campaign: string;
  adset: string;
  account_id: string;
  account_name: string;
  thumbnail_url: string | null;
  deconstruction: AdDeconstruction;
  metrics: DailyAdMetrics;
  consistency: {
    tier: ConsistencyTier;
    winning_days: number;
    max_consecutive: number;
  };
}

export interface ComparativeReport {
  summary: string;
  tiers: {
    stable_winner: Array<{ ad_id: string; reason: string }>;
    spike: Array<{ ad_id: string; reason: string }>;
    stable_loser: Array<{ ad_id: string; reason: string }>;
    dead: Array<{ ad_id: string; reason: string }>;
  };
  winner_dna: {
    hook_patterns: string[];
    scene_beats: string[];
    tone: string;
    cta_patterns: string[];
    visual_style: string;
    pacing_notes: string;
  };
  loser_dna: {
    hook_patterns: string[];
    scene_beats: string[];
    tone: string;
    cta_patterns: string[];
    visual_style: string;
    pacing_notes: string;
  };
  avatar_diagnosis: {
    avatar_fit_score: number;
    misses: string[];
    mechanism_gaps: string[];
    evidence: Array<{ ad_id: string; timestamp: string; note: string }>;
  };
  next_creatives: Array<{
    title: string;
    hook: string;
    scene_beats: string[];
    cta: string;
    hypothesis: string;
    replaces_ad_id: string | null;
    angle: string;
  }>;
  avoid_list: string[];
}

export interface ComparativeAnalysisRow {
  id: string;
  ad_ids: string[];
  ad_ids_hash: string;
  account_ids: string[];
  store_name: string | null;
  date_preset: string;
  analysis: ComparativeReport;
  inputs_snapshot: unknown;
  model: string | null;
  created_at: string;
}
