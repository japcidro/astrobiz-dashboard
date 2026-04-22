export type ApprovedScriptStatus =
  | "approved"
  | "in_production"
  | "shot"
  | "live"
  | "archived";

export type ApprovedScriptAngleType = "D" | "E" | "M" | "B";

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
  "in_production",
  "shot",
  "live",
  "archived",
];

export const STATUS_LABELS: Record<ApprovedScriptStatus, string> = {
  approved: "Approved",
  in_production: "In Production",
  shot: "Shot",
  live: "Live",
  archived: "Archived",
};

export const ANGLE_TYPE_LABELS: Record<ApprovedScriptAngleType, string> = {
  D: "Desire-led",
  E: "Experience-led",
  M: "Emotion-led",
  B: "Behavior-led",
};
