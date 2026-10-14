import { ENGINES, type EngineId, type Quality } from "@/lib/hook-studio/engines";

/**
 * How a Remake Studio still becomes a clip. The three Hook Studio engines
 * carry over; two lipsync engines speak the marketer's script.
 *
 * Credits per second are the CLI's estimates for 9:16 output
 * (2026-10-14); the worker records the live estimate per job.
 */
export type ClipEngineId = EngineId | "wan_lipsync" | "seedance_lipsync";

export type ClipMode = "motion" | "prompt" | "speak";

export interface ClipEngine {
  id: ClipEngineId;
  mode: ClipMode;
  name: string;
  blurb: string;
  perSecond: Record<Quality, number>;
  qualityLabels: Record<Quality, string> | null;
  minSeconds: number;
  maxSeconds: number;
}

const hook = (id: EngineId, mode: ClipMode, blurb: string): ClipEngine => {
  const e = ENGINES.find((x) => x.id === id)!;
  return { id, mode, name: e.name, blurb, perSecond: e.perSecond, qualityLabels: e.qualityLabels, minSeconds: e.minSeconds, maxSeconds: e.maxSeconds };
};

export const CLIP_ENGINES: ClipEngine[] = [
  hook("genjutsu", "motion", "Copies the real shot's camera and body movement onto the new person. Most realistic for b-rolls and silent talking heads."),
  hook("kling_i2v", "prompt", "Animates the still from a written prompt. Cheapest; good for simple b-roll motion."),
  hook("kling_turbo", "prompt", "Faster Kling for very simple motion."),
  {
    id: "wan_lipsync",
    mode: "speak",
    name: "Wan 2.7 lipsync",
    blurb: "The new person speaks your script. Needs the voice generated first; clip length follows the audio.",
    perSecond: { standard: 1.5, high: 2.5 },
    qualityLabels: { standard: "720p", high: "1080p" },
    minSeconds: 3,
    maxSeconds: 15,
  },
  {
    id: "seedance_lipsync",
    mode: "speak",
    name: "Seedance 2.0 lipsync",
    blurb: "Alternative lipsync engine, stronger on expressive delivery. Pricier.",
    perSecond: { standard: 4.5, high: 6 },
    qualityLabels: { standard: "720p", high: "1080p" },
    minSeconds: 4,
    maxSeconds: 15,
  },
];

export const DEFAULT_CLIP_ENGINE: Record<"talking_head" | "broll", ClipEngineId> = {
  talking_head: "wan_lipsync",
  broll: "genjutsu",
};

export function getClipEngine(id: string): ClipEngine | undefined {
  return CLIP_ENGINES.find((e) => e.id === id);
}

export function isClipEngine(id: unknown): id is ClipEngineId {
  return typeof id === "string" && CLIP_ENGINES.some((e) => e.id === id);
}

export function clipEstimate(engine: ClipEngineId, quality: Quality, seconds: number): number {
  const e = getClipEngine(engine);
  if (!e) return 0;
  const s = Math.min(e.maxSeconds, Math.max(e.minSeconds, Math.ceil(seconds)));
  return Math.round(e.perSecond[quality] * s * 100) / 100;
}

/** Nano Banana Pro still, with product references. */
export const STILL_CREDITS = 2;
/** Text-to-speech: about 0.15 credits per short sentence. */
export const TTS_CREDITS_PER_CHAR = 0.003;
/** Longest script the lipsync engines can carry in one clip. */
export const MAX_SPEAK_SECONDS = 15;
