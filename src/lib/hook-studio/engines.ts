/**
 * Hook Studio engines — the Higgsfield CLI models that can remake a
 * reference video with a new person, and the face generator.
 *
 * Shared by the page (cards, credits) and the Mac worker (command line).
 * Credits are the CLI's own estimates measured on 2026-09-28 for a
 * 5-second 9:16 reference; the worker records the live estimate per job.
 */

export type EngineId = "kling_edit" | "gemini_edit" | "genjutsu" | "seedance_edit";

export type Quality = "standard" | "high";

export interface Engine {
  id: EngineId;
  name: string;
  /** One line for the card. */
  blurb: string;
  /** Approximate credits per remake by quality. */
  credits: Record<Quality, number>;
  /** Labels for the quality switch; null when the engine has one tier. */
  qualityLabels: Record<Quality, string> | null;
  /** True when the engine cannot run without a pinned face. */
  needsFace: boolean;
  /** True when a pinned face is passed to the model when present. */
  usesFace: boolean;
}

export const ENGINES: Engine[] = [
  {
    id: "genjutsu",
    name: "Genjutsu motion transfer",
    blurb: "A pinned face performs the reference's exact motion. The only engine that truly changes the person. Default.",
    credits: { standard: 35, high: 55 },
    qualityLabels: { standard: "720p", high: "1080p" },
    needsFace: true,
    usesFace: true,
  },
  {
    id: "kling_edit",
    name: "Kling 3.0 Omni Edit",
    blurb: "Cheap clean-up of the reference: removes text, changes clothes and lighting. Keeps the same person.",
    credits: { standard: 7.5, high: 10 },
    qualityLabels: { standard: "Standard", high: "Pro" },
    needsFace: false,
    usesFace: true,
  },
  {
    id: "gemini_edit",
    name: "Gemini Omni Flash 1.1",
    blurb: "Regenerates from the reference. Changes hair and clothes; the face stays similar.",
    credits: { standard: 15, high: 15 },
    qualityLabels: null,
    needsFace: false,
    usesFace: true,
  },
  {
    id: "seedance_edit",
    name: "Seedance 2.5 Edit",
    blurb: "High-fidelity edit of the reference. Changes clothes; the face stays similar. Slow.",
    credits: { standard: 38, high: 60 },
    qualityLabels: { standard: "720p", high: "1080p" },
    needsFace: false,
    usesFace: true,
  },
];

export const DEFAULT_ENGINE: EngineId = "genjutsu";

export function getEngine(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** Soul 2 face candidates: credits per image at 1.5k. */
export const FACE_CREDITS = 0.12;
export const FACES_PER_BATCH = 4;

/** Longest reference the models accept, in seconds. */
export const MAX_REFERENCE_SECONDS = 15;

/** Params stored on a remake job. */
export interface RemakeParams {
  engine: EngineId;
  quality: Quality;
  prompt: string;
  /** Storage path of the trimmed reference's source. */
  reference_path: string;
  trim_start: number;
  trim_end: number | null;
  /** Storage path of the pinned face image, if any. */
  face_path: string | null;
}

/** Params stored on a face job. */
export interface FaceParams {
  prompt: string;
  creator: string;
}

export function remakeCredits(engine: EngineId, quality: Quality, count: number): number {
  const e = getEngine(engine);
  if (!e) return 0;
  return e.credits[quality] * count;
}
