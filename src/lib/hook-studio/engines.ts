/**
 * Hook Studio engines — the Higgsfield CLI models behind the two skills,
 * plus the UGC image generator.
 *
 * Shared by the pages (cards, credits) and the Mac worker (command lines).
 * Credits are the CLI's own estimates measured on 2026-09-28 for 9:16
 * output; the worker records the live estimate per job.
 */

/** How a video is made from the UGC image. */
export type Skill = "motion" | "arcads";

export const SKILLS: Array<{ id: Skill; name: string; blurb: string; needsReference: boolean }> = [
  {
    id: "motion",
    name: "Higgsfield motion transfer",
    blurb: "Upload a reference clip. The person and scene from your UGC image perform the reference's exact camera motion and action.",
    needsReference: true,
  },
  {
    id: "arcads",
    name: "Arcads-style, our version",
    blurb: "No reference clip. Claude writes a shot-by-shot prompt from your UGC image and your brief; the engine animates it. Cheaper, motion is described rather than copied.",
    needsReference: false,
  },
];

export type EngineId =
  | "genjutsu"
  | "seedance_ref"
  | "kling_i2v"
  | "kling_turbo"
  | "seedance_i2v";

export type Quality = "standard" | "high";

export interface Engine {
  id: EngineId;
  skill: Skill;
  name: string;
  blurb: string;
  /** Credits per second of output by quality. */
  perSecond: Record<Quality, number>;
  /** Labels for the quality switch; null when the engine has one tier. */
  qualityLabels: Record<Quality, string> | null;
  /** Durations the model accepts, in seconds. */
  minSeconds: number;
  maxSeconds: number;
  /** True when the clip length follows the reference (duration control ignored). */
  followsReference: boolean;
}

export const ENGINES: Engine[] = [
  {
    id: "genjutsu",
    skill: "motion",
    name: "Genjutsu motion transfer",
    blurb: "Copies the reference's motion onto the person in your image. Length follows the reference.",
    perSecond: { standard: 7, high: 11 },
    qualityLabels: { standard: "720p", high: "1080p" },
    minSeconds: 3,
    maxSeconds: 15,
    followsReference: true,
  },
  {
    id: "seedance_ref",
    skill: "motion",
    name: "Seedance 2.0 with references",
    blurb: "Your image and the reference clip go in as references; Seedance re-renders the scene with the reference's camera and timing.",
    perSecond: { standard: 4.5, high: 9 },
    qualityLabels: { standard: "720p", high: "1080p" },
    minSeconds: 4,
    maxSeconds: 15,
    followsReference: false,
  },
  {
    id: "kling_i2v",
    skill: "arcads",
    name: "Kling 3.0",
    blurb: "Animates your image from the prompt. Cheapest per second; good handheld realism.",
    perSecond: { standard: 1.25, high: 1.5 },
    qualityLabels: { standard: "Standard", high: "Pro" },
    minSeconds: 3,
    maxSeconds: 15,
    followsReference: false,
  },
  {
    id: "kling_turbo",
    skill: "arcads",
    name: "Kling 3.0 Turbo",
    blurb: "Faster Kling for simple motion.",
    perSecond: { standard: 1.5, high: 1.5 },
    qualityLabels: null,
    minSeconds: 3,
    maxSeconds: 15,
    followsReference: false,
  },
  {
    id: "seedance_i2v",
    skill: "arcads",
    name: "Seedance 2.0",
    blurb: "Best motion and identity consistency from a still. Pricier.",
    perSecond: { standard: 4.5, high: 9 },
    qualityLabels: { standard: "720p", high: "1080p" },
    minSeconds: 4,
    maxSeconds: 15,
    followsReference: false,
  },
];

export const DEFAULT_ENGINE: Record<Skill, EngineId> = {
  motion: "genjutsu",
  arcads: "kling_i2v",
};

export function getEngine(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function enginesForSkill(skill: Skill): Engine[] {
  return ENGINES.filter((e) => e.skill === skill);
}

/** Estimated credits for one clip. */
export function clipCredits(engine: EngineId, quality: Quality, seconds: number): number {
  const e = getEngine(engine);
  if (!e) return 0;
  const s = Math.min(e.maxSeconds, Math.max(e.minSeconds, seconds));
  return Math.round(e.perSecond[quality] * s * 100) / 100;
}

/** UGC Generator: Nano Banana Pro, one image per job, 9:16. */
export const UGC_ENGINE = "nano_banana_pro";
export const UGC_CREDITS_PER_IMAGE = 2;
export const UGC_MAX_PER_BATCH = 4;

/** Longest reference the motion engines accept, in seconds. */
export const MAX_REFERENCE_SECONDS = 15;

/** Params stored on a remake (video) job. */
export interface RemakeParams {
  skill: Skill;
  engine: EngineId;
  quality: Quality;
  duration: number;
  prompt: string;
  /** Storage path of the UGC image the clip is built from. */
  ugc_path: string;
  /** Storage path of the reference clip (motion skill only). */
  reference_path: string | null;
  trim_start: number;
  trim_end: number | null;
}

/** Params stored on a UGC image job. */
export interface UgcParams {
  source_path: string;
  prompt: string;
  note: string;
}
