import type {
  AwarenessLevel,
  FunnelStage,
  VariationVariable,
} from "@/lib/ai/v2-frameworks";

export type ApprovedScriptStatus =
  | "approved"
  | "in_progress"
  | "submitted"
  | "archived";

export type ApprovedScriptAngleType = "D" | "E" | "M" | "B";

// Performance-feedback states. Set automatically by the cron when an ad
// linked to this script reaches stable_winner / stable_loser tiers, OR
// manually by an admin from the library UI.
export type ApprovedScriptPerformanceStatus =
  | "pending"
  | "testing"
  | "validated_winner"
  | "validated_loser";

export interface ApprovedScriptPerformanceMetrics {
  roas: number;
  cpp: number;
  purchases: number;
  max_consecutive: number;
}

export interface ApprovedScript {
  id: string;
  store_name: string;
  source_thread_id: string | null;
  source_message_index: number | null;
  script_number: number | null;
  angle_title: string;
  avatar: string | null;
  angle_type: ApprovedScriptAngleType | null;
  intensity: number | null;
  capacity: number | null;
  hook: string;
  body_script: string;
  variant_hooks: string[];
  status: ApprovedScriptStatus;
  production_notes: string | null;
  final_video_url: string | null;
  approved_by: string;
  approved_at: string;
  updated_by: string | null;
  updated_at: string;

  // — v2.0 classification (nullable: legacy rows pre-v2 won't have these) —
  awareness_level: AwarenessLevel | null;
  funnel_stage: FunnelStage | null;
  hook_framework: string | null;
  strategic_format: string | null;
  video_format: string | null;
  big_idea: string | null;
  variable_shifts: VariationVariable[];

  // — Provenance: was this script seeded from a deconstructed winner? —
  source_winner_ad_id: string | null;
  source_winner_analysis_id: string | null;

  // — Performance feedback loop —
  performance_status: ApprovedScriptPerformanceStatus;
  performance_validated_at: string | null;
  performance_metrics: ApprovedScriptPerformanceMetrics | null;
}

export interface CreateApprovedScriptInput {
  store_name: string;
  source_thread_id?: string | null;
  source_message_index?: number | null;
  script_number: number | null;
  angle_title: string;
  avatar?: string | null;
  angle_type?: ApprovedScriptAngleType | null;
  intensity?: number | null;
  capacity?: number | null;
  hook: string;
  body_script: string;
  variant_hooks?: string[];

  // — v2.0 classification (optional on create — backfilled by feedback loop) —
  awareness_level?: AwarenessLevel | null;
  funnel_stage?: FunnelStage | null;
  hook_framework?: string | null;
  strategic_format?: string | null;
  video_format?: string | null;
  big_idea?: string | null;
  variable_shifts?: VariationVariable[];

  // — Optional winner provenance —
  source_winner_ad_id?: string | null;
  source_winner_analysis_id?: string | null;
}

export interface UpdateApprovedScriptInput {
  status?: ApprovedScriptStatus;
  production_notes?: string | null;
  final_video_url?: string | null;
  angle_title?: string;
  hook?: string;
  body_script?: string;
  variant_hooks?: string[];
}

export const APPROVED_SCRIPT_STATUSES: ApprovedScriptStatus[] = [
  "approved",
  "in_progress",
  "submitted",
  "archived",
];

export const STATUS_LABELS: Record<ApprovedScriptStatus, string> = {
  approved: "Approved",
  in_progress: "In Progress",
  submitted: "Submitted",
  archived: "Archived",
};

export const ANGLE_TYPE_LABELS: Record<ApprovedScriptAngleType, string> = {
  D: "Desire-led",
  E: "Experience-led",
  M: "Emotion-led",
  B: "Behavior-led",
};
