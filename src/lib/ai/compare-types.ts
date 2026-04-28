import type { ConsistencyTier, DailyAdMetrics } from "@/lib/facebook/insights-daily";

// Mirrors the AdDeconstruction shape in lib/gemini/deconstruct.ts. Legacy
// fields are required (consumed by compare flow + approved-library UI).
// v2.0 Winning DNA Report fields are optional here so older rows in
// ad_creative_analyses (analyzed before the v2.0 prompt rollout) still type-
// check when read back.
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

  // — v2.0 Winning DNA Report (optional for backward compat) —
  fingerprint?: string;
  classification?: {
    avatar: string;
    angle: string;
    awareness_level: "L1" | "L2" | "L3" | "L4" | "L5";
    funnel_stage: "TOFU" | "MOFU" | "BOFU";
    hook_framework: string;
    strategic_format: string;
    video_format: string;
  };
  hook_anatomy?: {
    attention_trigger: string;
    information_gap: string;
    implied_promise: string;
  };
  beat_map?: {
    hook: { range: string; content: string };
    body_open: { range: string; content: string };
    body_core: { range: string; content: string };
    close: { range: string; content: string };
    cut_frequency: string;
    text_overlay_timestamps: string[];
  };
  uvp?: {
    core_promise: string;
    mechanism: string;
    differentiator: string;
    proof_element: string;
    cost_effort_frame: string;
  };
  open_loop?: {
    opened_at: string;
    opened_content: string;
    closed_at: string;
    closed_content: string;
    closure_quality: "earned" | "partial" | "broken";
  };
  viral_mechanism?: string;
  format_compatibility?: Array<{
    format_number: string;
    format_name: string;
    fit_reason: string;
    script_shift: string;
  }>;
  angle_variations?: Array<{
    angle: string;
    hook_framework: string;
    formats: string;
  }>;
  cross_check_findings?: string[];
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
