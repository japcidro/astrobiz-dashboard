import type { Quality } from "@/lib/hook-studio/engines";
import type { VoiceGender } from "@/lib/remake/types";

export type TalkingHeadEngine = "veo3_1" | "veo3";
export type TalkingHeadStatus = "queued" | "running" | "done" | "failed";

/** A still the Clipper generated, offered as a starting image. */
export interface StartingImage {
  shot_id: string;
  project_id: string;
  project_title: string;
  clip_idx: number;
  url: string;
  preview_url: string;
  voice_gender: VoiceGender | null;
  voice_profile: string;
  created_at: string;
}

export interface TalkingHeadRow {
  id: string;
  still_path: string;
  still_preview_path: string | null;
  source_shot_id: string | null;
  source_project_id: string | null;
  title: string;
  script: string;
  voice_direction: string;
  voice_gender: VoiceGender | null;
  voice_profile: string;
  engine: TalkingHeadEngine;
  quality: Quality;
  seconds: 4 | 6 | 8;
  status: TalkingHeadStatus;
  job_id: string | null;
  clip_path: string | null;
  credits: number | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TalkingHeadView extends TalkingHeadRow {
  still_url: string | null;
  clip_url: string | null;
}

export interface TalkingHeadPage {
  stills: StartingImage[];
  renders: TalkingHeadView[];
}
