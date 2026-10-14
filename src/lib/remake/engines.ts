import { ENGINES, type EngineId, type Quality } from "@/lib/hook-studio/engines";

/**
 * How a Clipper still becomes a clip. Every engine starts from OUR still
 * (new person, our product): Veo speaks the script with its own voice,
 * Genjutsu copies the real clip's motion, Kling animates from a prompt.
 *
 * Credits are the CLI's estimates for 9:16 output (2026-10-14); the worker
 * records the live estimate per job.
 */
export type ClipEngineId = "veo3_1" | "veo3" | Extract<EngineId, "genjutsu" | "kling_i2v">;

export type ClipMode = "speak" | "motion" | "prompt";

export interface ClipEngine {
  id: ClipEngineId;
  mode: ClipMode;
  name: string;
  blurb: string;
  /** Fixed lengths the model accepts; null = follows the real clip. */
  lengths: number[] | null;
  /** Credits for a clip of n seconds at a quality. */
  cost: (seconds: number, quality: Quality) => number;
  qualityLabels: Record<Quality, string> | null;
}

const hookEngine = (id: "genjutsu" | "kling_i2v") => ENGINES.find((e) => e.id === id)!;

export const CLIP_ENGINES: ClipEngine[] = [
  {
    id: "veo3_1",
    mode: "speak",
    name: "Veo 3.1",
    blurb: "Starts from our still and speaks the script with its own voice and lips. 4, 6 or 8 seconds.",
    lengths: [4, 6, 8],
    cost: (s, q) => (q === "high" ? 10 : 4) * (s === 4 ? 4 : s === 6 ? 6 : 8),
    qualityLabels: { standard: "Fast", high: "Preview · high" },
  },
  {
    id: "veo3",
    mode: "speak",
    name: "Veo 3",
    blurb: "Same idea, fixed 8 seconds. Cheaper on Fast.",
    lengths: [8],
    cost: (_s, q) => (q === "high" ? 58 : 22),
    qualityLabels: { standard: "Fast", high: "Preview" },
  },
  {
    id: "genjutsu",
    mode: "motion",
    name: "Genjutsu motion copy",
    blurb: "Silent. Our still performs the real clip's exact camera and body movement; length follows the real clip.",
    lengths: null,
    cost: (s, q) => Math.round(hookEngine("genjutsu").perSecond[q] * Math.min(15, Math.max(3, s)) * 100) / 100,
    qualityLabels: { standard: "720p", high: "1080p" },
  },
  {
    id: "kling_i2v",
    mode: "prompt",
    name: "Kling 3.0",
    blurb: "Silent, cheapest. Animates our still from a short motion prompt.",
    lengths: null,
    cost: (s, q) => Math.round(hookEngine("kling_i2v").perSecond[q] * Math.min(15, Math.max(3, s)) * 100) / 100,
    qualityLabels: { standard: "Standard", high: "Pro" },
  },
];

export const DEFAULT_CLIP_ENGINE: ClipEngineId = "veo3_1";

export function getClipEngine(id: string): ClipEngine | undefined {
  return CLIP_ENGINES.find((e) => e.id === id);
}

export function isClipEngine(id: unknown): id is ClipEngineId {
  return typeof id === "string" && CLIP_ENGINES.some((e) => e.id === id);
}

/** The Veo length that covers the real clip: 3.2 s → 4, 5 s → 6, anything longer → 8. */
export function veoLengthFor(seconds: number): number {
  return seconds <= 4 ? 4 : seconds <= 6 ? 6 : 8;
}

export function clipEstimate(engine: ClipEngineId, quality: Quality, seconds: number): number {
  const e = getClipEngine(engine);
  return e ? e.cost(seconds, quality) : 0;
}

/** Nano Banana Pro still, with product references. */
export const STILL_CREDITS = 2;
/** ElevenLabs v4: about 0.2 credits per sentence. */
export const VO_CREDITS_PER_CHAR = 0.005;
