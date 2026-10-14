import type { Quality } from "@/lib/hook-studio/engines";
import type { LookId } from "@/lib/hook-studio/presets";
import type { ClipEngineId } from "./engines";

export type ProjectStatus = "splitting" | "classifying" | "ready" | "failed";
export type StepStatus = "none" | "queued" | "running" | "done" | "failed";
export type ShotKind = "talking_head" | "broll";

export interface BrandCheck {
  ok: boolean;
  notes: string;
}

export interface ProjectRow {
  id: string;
  title: string;
  store: string | null;
  board_item_id: string | null;
  source_path: string;
  source_duration: number | null;
  status: ProjectStatus;
  error: string | null;
  cast_look: LookId;
  cast_note: string;
  cast_shot_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShotRow {
  id: string;
  project_id: string;
  idx: number;
  start_s: number;
  end_s: number;
  kind: ShotKind;
  selected: boolean;
  brand_heavy: boolean;
  description: string | null;
  frame_path: string | null;
  still_job_id: string | null;
  still_path: string | null;
  still_status: StepStatus;
  still_error: string | null;
  brand_check: BrandCheck | null;
  approved: boolean;
  script: string;
  voice_id: string | null;
  voice_type: string | null;
  voice_name: string | null;
  tts_job_id: string | null;
  audio_path: string | null;
  audio_seconds: number | null;
  audio_status: StepStatus;
  audio_error: string | null;
  clip_engine: ClipEngineId;
  clip_quality: Quality;
  clip_prompt: string | null;
  clip_job_id: string | null;
  clip_path: string | null;
  clip_status: StepStatus;
  clip_error: string | null;
  clip_credits: number | null;
  created_at: string;
  updated_at: string;
}

export interface ShotView extends ShotRow {
  frame_url: string | null;
  still_url: string | null;
  audio_url: string | null;
  clip_url: string | null;
  seconds: number;
}

export interface BrandImage {
  id: string;
  store: string;
  path: string;
  label: string | null;
  url: string | null;
  created_at: string;
}

export interface BrandKit {
  store: string;
  rules: string;
  images: BrandImage[];
}

export interface ProjectView extends ProjectRow {
  source_url: string | null;
  board_item_title: string | null;
  shots: ShotView[];
  brand_kit: BrandKit | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  store: string | null;
  status: ProjectStatus;
  shots: number;
  clips_done: number;
  cover_url: string | null;
  created_at: string;
}

export interface Voice {
  id: string;
  name: string;
  type: "preset" | "element";
}
