import type { BeatStyle, CartoonResolution, CartoonStyle } from "./types";

/**
 * Cartoon Hooks runs on the cheapest Higgsfield models that passed the
 * side-by-side test on 2026-10-15: Seedream 5.0 Flash for every image and
 * Seedance 2.0 Mini for every clip. The worker (worker/hook-worker.mjs)
 * mirrors the CLI arguments; keep the two in step.
 */
export const IMAGE_MODEL = "seedream_5_0_flash";
export const CLIP_MODEL = "seedance_2_0_mini";

/** Credits from `higgsfield generate cost` on 2026-10-15. */
export const IMAGE_CREDITS = 0.5;
export const CLIP_CREDITS_PER_SECOND: Record<CartoonResolution, number> = { "480p": 0.5, "720p": 1 };
export const VOICE_CREDITS_PER_LINE = 0.25;

/** Seedance 2.0 Mini takes 4 to 15 seconds; a beat's clip is trimmed to the beat when the hook is joined. */
export const CLIP_MIN_SECONDS = 4;
export const CLIP_MAX_SECONDS = 15;

export const MAX_BEATS = 12;
export const MAX_VARIANTS = 3;

export function clipSecondsFor(beatSeconds: number): number {
  return Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, Math.ceil(beatSeconds + 0.3)));
}

export const STYLES: Array<{ id: CartoonStyle; name: string; blurb: string }> = [
  { id: "pixar3d", name: "3D animated", blurb: "Soft 3D movie look, like the tito with the tummy" },
  { id: "flat2d", name: "2D flat", blurb: "Thick outlines, flat colors, round-head webcomic people" },
  { id: "medical", name: "Medical glow", blurb: "Glowing see-through body, hormones, cells, test tubes" },
  { id: "mixed", name: "Mixed", blurb: "Claude picks per beat, like the reference ads" },
];

export const styleName = (s: string) => (s === "science" ? "Science illustration" : STYLES.find((x) => x.id === s)?.name ?? s);

/** The look every image of that style starts from. */
export const STYLE_LOOK: Record<Exclude<BeatStyle, "science">, string> = {
  pixar3d: "3D animated movie style, soft cinematic lighting, expressive stylized characters, rich detailed set.",
  flat2d: "Full-bleed flat 2D cartoon illustration, thick black outlines, simple flat colors, webcomic style, simple round-head characters.",
  medical: "Glowing medical 3D visualization on a dark blue background, translucent glass-like anatomy, glowing orange and blue energy, cinematic.",
};

const FRAME = "Vertical 9:16, full-bleed, fills the whole frame edge to edge, no border. No text, no captions, no letters, no logos, no watermark.";

/** The character image every beat with the main character is drawn from. */
export function characterPrompt(style: Exclude<BeatStyle, "science">, description: string): string {
  return `${STYLE_LOOK[style]} Character design of ${description.trim()}. One character only, full body from head to feet, standing, facing the camera, neutral expression, plain soft light background. ${FRAME}`;
}

export function stillPrompt(style: Exclude<BeatStyle, "science">, scene: string, withCharacter: boolean): string {
  const keep = withCharacter ? " The main character is the exact same person as in the reference image: same face, hair, body, outfit and art style." : "";
  return `${STYLE_LOOK[style]} ${scene.trim()}${keep} ${FRAME}`;
}

export function motionPrompt(style: Exclude<BeatStyle, "science">, motion: string): string {
  const keep = style === "flat2d" ? "Keep the exact flat 2D cartoon style with thick black outlines." : style === "medical" ? "Keep the exact glowing medical visualization style." : "Keep the exact 3D animated style and character.";
  return `${motion.trim()} ${keep} No text, no captions.`;
}

export function estimateCredits(input: { beats: Array<{ seconds: number }>; resolution: CartoonResolution; voice: boolean; character: boolean }): number {
  let total = input.character ? IMAGE_CREDITS : 0;
  for (const b of input.beats) {
    total += IMAGE_CREDITS + clipSecondsFor(b.seconds) * CLIP_CREDITS_PER_SECOND[input.resolution];
    if (input.voice) total += VOICE_CREDITS_PER_LINE;
  }
  return Math.round(total * 10) / 10;
}

/** Before Claude has split the script: about 2.6 Taglish words a second, beats of ~2.5 s. */
export function roughEstimate(script: string, resolution: CartoonResolution, voice: boolean): { beats: number; credits: number } {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const beats = Math.max(1, Math.min(MAX_BEATS, Math.round(words / 2.6 / 2.5)));
  return { beats, credits: estimateCredits({ beats: Array.from({ length: beats }, () => ({ seconds: 2.5 })), resolution, voice, character: true }) };
}
