import type { Quality } from "@/lib/hook-studio/engines";
import type { LookId } from "@/lib/hook-studio/presets";
import type { ClipEngineId } from "./engines";

export type ProjectStatus = "splitting" | "classifying" | "ready" | "failed";
export type StepStatus = "none" | "queued" | "running" | "done" | "failed";
export type ShotKind = "talking_head" | "broll";
/** keep = use the real clip as it is; swap = redo it from our still. */
export type ShotMode = "keep" | "swap";

export interface BrandCheck {
  ok: boolean;
  notes: string;
}

/** The voice Veo gives a talking head; read off the still, editable per clip. */
export type VoiceGender = "male" | "female";

/** What the still does with the scene: put OUR product in ("product"), or copy the reference as it is and only swap the person ("copy"). */
export type BrandMode = "product" | "copy";

export interface ProjectRow {
  id: string;
  title: string;
  store: string | null;
  board_item_id: string | null;
  source_path: string;
  source_duration: number | null;
  strip_path: string | null;
  strip_count: number | null;
  /** Seconds the strip's tiles spread over evenly (tile i covers [i·span/n, (i+1)·span/n]); null on old one-tile-per-second strips. */
  strip_span: number | null;
  /** Tiles per row, numbered in the corner; null on old strips (one unnumbered row). */
  strip_cols: number | null;
  status: ProjectStatus;
  error: string | null;
  cast_look: LookId;
  cast_note: string;
  cast_shot_id: string | null;
  /** Who the voice is, for every Veo talking head (accent, age, tone). Empty = the Taglish default. */
  voice_profile: string;
  /** A picked person image (UGC library or upload); wins over cast_shot_id. */
  cast_path: string | null;
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
  mode: ShotMode;
  person: string | null;
  /** What the person holds or shows in the frame; a ProductForm or 'none'. */
  holds: string | null;
  brand_mode: BrandMode;
  selected: boolean;
  brand_heavy: boolean;
  description: string | null;
  frame_path: string | null;
  ref_path: string | null;
  still_job_id: string | null;
  still_path: string | null;
  still_preview_path: string | null;
  still_status: StepStatus;
  still_error: string | null;
  brand_check: BrandCheck | null;
  /** How many times the current still has been generated (the check regenerates once by itself when the wrong person came out). */
  still_attempts: number;
  approved: boolean;
  script: string;
  voice_direction: string;
  /** Male or female voice for Veo talking heads; set by the brand check from the still, null until then. */
  voice_gender: VoiceGender | null;
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
  clip_seconds: number | null;
  clip_prompt: string | null;
  clip_job_id: string | null;
  clip_path: string | null;
  clip_status: StepStatus;
  clip_error: string | null;
  clip_credits: number | null;
  mixed_path: string | null;
  mixed_key: string | null;
  mixed_status: StepStatus;
  created_at: string;
  updated_at: string;
}

export interface ShotView extends ShotRow {
  frame_url: string | null;
  ref_url: string | null;
  still_url: string | null;
  /** Small JPEG of the still for thumbnails; falls back to the full still. */
  still_preview_url: string | null;
  audio_url: string | null;
  clip_url: string | null;
  mixed_url: string | null;
  /** What the tray shows for this shot: the mixed clip, our clip, or the kept real clip. */
  final_url: string | null;
  seconds: number;
}

/** What a product photo or a held object shows. */
export type ProductForm = "bottle" | "gummies" | "capsules" | "box" | "sachet" | "tube" | "jar" | "other";
export const PRODUCT_FORMS: ProductForm[] = ["bottle", "gummies", "capsules", "box", "sachet", "tube", "jar", "other"];

export interface BrandImage {
  id: string;
  store: string;
  path: string;
  label: string | null;
  kind: ProductForm | null;
  description: string | null;
  url: string | null;
  created_at: string;
}

export interface BrandKit {
  store: string;
  rules: string;
  /** What the Image Studio planner knows about the brand: product, price, audience, angle, look, compliance. */
  profile: string;
  images: BrandImage[];
}

/** A person in the brand's own person-library folder (named like the store): its models for static ads. */
export interface BrandModel {
  id: string;
  name: string;
  bucket: string;
  path: string;
  url: string | null;
  created_at: string;
}

/** One brand on the Brand Kit page: how far its kit is filled in. */
export interface BrandKitSummary {
  store: string;
  photos: number;
  unlabelled: number;
  has_profile: boolean;
  has_rules: boolean;
}

export interface ProjectView extends ProjectRow {
  source_url: string | null;
  strip_url: string | null;
  cast_url: string | null;
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

/** A finished UGC Generator image the still can be taken from. */
/** A folder in the person library (FOLIQ, Momentum, …). */
export interface PersonFolder {
  id: string;
  name: string;
  created_at: string;
}

/** Someone who can be put into every clip: a UGC Generator image or an uploaded photo. */
export interface Person {
  id: string;
  /** null = Unsorted (the root view). */
  folder_id: string | null;
  name: string;
  url: string;
  /** Set when this person came out of the UGC Generator. */
  ugc_job_id: string | null;
  created_at: string;
}

export interface PersonLibrary {
  folders: PersonFolder[];
  people: Person[];
}

/** What the picker hands back: a library person, or (legacy) a UGC job / an upload path. */
export interface CastSource {
  person_id?: string;
  ugc_job_id?: string;
  path?: string;
}
