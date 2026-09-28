import type { EngineId, Quality, Skill } from "./engines";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface HookRow {
  id: string;
  brief: string;
  skill: Skill;
  engine: EngineId | null;
  quality: Quality;
  duration: number;
  ugc_job_id: string | null;
  reference_path: string | null;
  reference_name: string | null;
  reference_duration: number | null;
  reference_width: number | null;
  reference_height: number | null;
  trim_start: number;
  trim_end: number | null;
  edit_prompt: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  hook_id: string | null;
  kind: "remake" | "face" | "ugc_image";
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

/** A video job as the page sees it. */
export interface JobView extends Omit<JobRow, "params"> {
  engine_id: string;
  quality: Quality | null;
  duration: number | null;
  result_url: string | null;
}

/** A UGC Generator result: the swapped still plus the photo it came from. */
export interface UgcView {
  id: string;
  status: JobStatus;
  note: string;
  look: string | null;
  source_path: string;
  source_url: string | null;
  result_path: string | null;
  result_url: string | null;
  estimate_credits: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface HookView extends HookRow {
  ugc: UgcView | null;
  reference_url: string | null;
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
  title: string;
  skill: Skill;
  engine: EngineId | null;
  duration: number;
  ugc_url: string | null;
  clips_done: number;
  clips_pending: number;
  clips_failed: number;
  credits: number;
  created_at: string;
}
