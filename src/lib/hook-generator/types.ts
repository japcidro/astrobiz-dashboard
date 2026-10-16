export type StepStatus = "queued" | "running" | "done" | "failed";
/** planning → stills (waiting for approval) → working (runs by itself) → done. */
export type HookStatus = "planning" | "stills" | "working" | "done" | "failed";
export type ImageModel = "seedream_5_0_flash" | "nano_banana_pro";
export type VideoModel = "veo3_1" | "seedance_2_0_mini";
export type RefRole = "expert" | "client" | "setting" | "product" | "style";
/** The head-tap presets, plus "custom": a beat planned from the marketer's own direction, with no head-tap rule. */
export type BeatKind = "crown_pat" | "part_hair" | "lift_strands" | "hairline_tap" | "custom";

/** A reference image, sent to the image model in list order. */
export interface HookRef {
  bucket: string;
  path: string;
  role: RefRole;
  name: string;
}

export interface HookRefView extends HookRef {
  url: string | null;
}

export interface HookgenHookRow {
  id: string;
  batch_id: string;
  variant: number;
  title: string;
  direction: string;
  line: string;
  beat_kinds: BeatKind[];
  refs: HookRef[];
  image_model: ImageModel;
  video_model: VideoModel;
  voice: string;
  /** Planned, but the starting images wait until the marketer has read the prompts. */
  hold_stills: boolean;
  /** Clip length chosen for every beat; null = fit each beat's line. */
  clip_seconds: number | null;
  status: HookStatus;
  error: string | null;
  final_status: StepStatus | null;
  final_path: string | null;
  final_seconds: number | null;
  final_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HookgenBeatRow {
  id: string;
  hook_id: string;
  idx: number;
  kind: BeatKind;
  line: string;
  seconds: number;
  clip_seconds: number;
  /** The marketer chose clip_seconds: the whole clip goes into the hook. */
  clip_seconds_set: boolean;
  scene: string;
  motion: string;
  fix: string;
  still_prompt: string;
  motion_prompt: string;
  /** The marketer wrote the image / clip prompt; it is used as written. */
  still_custom: boolean;
  motion_custom: boolean;
  approved: boolean;
  still_status: StepStatus | null;
  still_path: string | null;
  still_preview_path: string | null;
  still_error: string | null;
  still_credits: number | null;
  clip_status: StepStatus | null;
  clip_path: string | null;
  clip_error: string | null;
  clip_credits: number | null;
  check_status: StepStatus | null;
  check_ok: boolean | null;
  check_notes: string | null;
  check_error: string | null;
  rerolls: number;
  created_at: string;
  updated_at: string;
}

export interface HookgenBeatView extends HookgenBeatRow {
  still_url: string | null;
  still_preview_url: string | null;
  clip_url: string | null;
}

/** A card on the list page: the hook plus enough of its beats to show progress. */
export interface HookgenSummary extends HookgenHookRow {
  final_url: string | null;
  cover_url: string | null;
  beats_total: number;
  stills_done: number;
  approved: number;
  clips_done: number;
  checks_done: number;
  credits: number;
}

export interface HookgenView extends HookgenSummary {
  refs_view: HookRefView[];
  beats: HookgenBeatView[];
}
