export type CartoonStyle = "pixar3d" | "flat2d" | "medical" | "mixed";
/** A beat's look; "science" belongs to the Science B-roll Generator, which shares these tables. */
export type BeatStyle = Exclude<CartoonStyle, "mixed"> | "science";
/** Which tool a row belongs to: Cartoon Hooks or the Science B-roll Generator. */
export type HookKind = "cartoon" | "science";
export type CartoonResolution = "480p" | "720p";
export type StepStatus = "queued" | "running" | "done" | "failed";
export type HookStatus = "planning" | "working" | "done" | "failed";
/** "elevenlabs" = the team's own ElevenLabs account, voiced by the app; "higgsfield" = Higgsfield's ElevenLabs, voiced by the Mac worker. */
export type VoiceProvider = "higgsfield" | "elevenlabs";

/** A voice the picker offers. */
export interface CartoonVoice {
  provider: VoiceProvider;
  id: string;
  name: string;
  /** Higgsfield "preset" / "element", ElevenLabs "cloned" / "generated" / "professional". */
  type: string;
}

export interface CartoonHookRow {
  id: string;
  kind: HookKind;
  batch_id: string;
  variant: number;
  title: string;
  script: string;
  style: CartoonStyle | "science";
  direction: string;
  resolution: CartoonResolution;
  voice_on: boolean;
  voice_provider: VoiceProvider;
  voice_id: string | null;
  voice_type: string | null;
  voice_name: string | null;
  status: HookStatus;
  error: string | null;
  character_desc: string;
  character_prompt: string | null;
  character_status: StepStatus | null;
  character_path: string | null;
  character_preview_path: string | null;
  character_error: string | null;
  character_credits: number | null;
  final_status: StepStatus | null;
  final_path: string | null;
  final_seconds: number | null;
  final_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CartoonBeatRow {
  id: string;
  hook_id: string;
  idx: number;
  line: string;
  seconds: number;
  style: BeatStyle;
  uses_character: boolean;
  scene: string;
  motion: string;
  still_prompt: string;
  motion_prompt: string;
  still_status: StepStatus | null;
  still_path: string | null;
  still_preview_path: string | null;
  still_error: string | null;
  still_credits: number | null;
  clip_status: StepStatus | null;
  clip_path: string | null;
  clip_error: string | null;
  clip_credits: number | null;
  voice_status: StepStatus | null;
  voice_path: string | null;
  voice_seconds: number | null;
  voice_error: string | null;
  voice_credits: number | null;
  /** Science B-roll only: the move, the still check and its automatic redraws. */
  move: string | null;
  check_prompt: string;
  check_status: StepStatus | null;
  check_ok: boolean | null;
  check_notes: string | null;
  check_error: string | null;
  still_redos: number;
  created_at: string;
  updated_at: string;
}

export interface CartoonBeatView extends CartoonBeatRow {
  still_url: string | null;
  still_preview_url: string | null;
  clip_url: string | null;
  voice_url: string | null;
}

/** A card on the list page: the hook plus enough of its beats to show progress. */
export interface CartoonHookSummary extends CartoonHookRow {
  character_url: string | null;
  final_url: string | null;
  cover_url: string | null;
  beats_total: number;
  stills_done: number;
  clips_done: number;
  credits: number;
}

export interface CartoonHookView extends CartoonHookSummary {
  beats: CartoonBeatView[];
}
