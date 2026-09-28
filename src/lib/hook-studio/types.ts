import type { EngineId, Quality } from "./engines";
import type { Lane, ScreenMode } from "./presets";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface HookRow {
  id: string;
  lane: Lane;
  brief: string;
  creator: string;
  screen_mode: ScreenMode;
  reference_path: string | null;
  reference_name: string | null;
  reference_duration: number | null;
  reference_width: number | null;
  reference_height: number | null;
  trim_start: number;
  trim_end: number | null;
  edit_prompt: string | null;
  text_options: string[];
  chosen_text: string | null;
  face_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  hook_id: string | null;
  kind: "remake" | "face";
  engine: string;
  params: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  estimate_credits: number | null;
  result_path: string | null;
  error: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface FaceRow {
  id: string;
  name: string;
  image_path: string;
  source: "soul" | "upload";
  creator: string | null;
  created_at: string;
}

/** What the page receives. Paths are swapped for signed URLs. */
export interface JobView extends Omit<JobRow, "params"> {
  engine_id: EngineId | "soul";
  quality: Quality | null;
  result_url: string | null;
}

export interface FaceView extends FaceRow {
  image_url: string | null;
}

export interface HookView extends HookRow {
  reference_url: string | null;
  face: FaceView | null;
  jobs: JobView[];
}

export interface WorkerStatus {
  online: boolean;
  last_seen: string | null;
  credits: number | null;
  plan: string | null;
  worker: string | null;
  version: string | null;
  queued: number;
  running: number;
}

export interface LibraryRow {
  id: string;
  lane: Lane;
  title: string;
  creator: string;
  reference_url: string | null;
  remakes_done: number;
  remakes_pending: number;
  remakes_failed: number;
  credits: number;
  created_at: string;
}
