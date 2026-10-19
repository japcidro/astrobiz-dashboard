import { CLIP_CREDITS_PER_SECOND, IMAGE_CREDITS, clipSecondsFor } from "@/lib/cartoon/engines";
import type { CartoonResolution } from "@/lib/cartoon/types";

/**
 * The Science B-roll skill: one style bible every still starts from, seven
 * named moves (what the reference ad's science shots do), the motion grammar
 * for each, and the check every still must pass before it is animated. Runs
 * on the Cartoon Hooks engines (Seedream 5.0 Flash stills, Seedance 2.0 Mini
 * clips) and the same Mac worker steps.
 */

export const MAX_BEATS = 10;
export const MAX_VARIANTS = 3;
/** Science beats are longer than cartoon beats: one idea, one slow move. */
export const MIN_BEAT_SECONDS = 3;
export const MAX_BEAT_SECONDS = 6;

export type MoveId = "cross_section" | "process" | "problem" | "calm" | "flow" | "split" | "comeback";

export interface Move {
  id: MoveId;
  name: string;
  /** What the shot is, for the planner and the marketer. */
  what: string;
  /** How the still is composed, in the style bible's terms. */
  composition: string;
  /** What moves over the clip. */
  motion: string;
  /** The highlight colour this move carries, for the check. */
  colour: string;
}

export const MOVES: Move[] = [
  {
    id: "cross_section",
    name: "Cross-section",
    what: "Tissue cut open to show what is inside: skin layers over a follicle, a gut wall, the stomach, a vein, a patch on skin.",
    composition: "A clean cross-section of the tissue filling the frame, the cut face toward the camera, the subject centred, the layers readable: outer surface on top, deeper layers below, vessels and fat where they belong. Nothing highlighted yet.",
    motion: "The camera pushes in slowly; a vessel pulses; nothing else moves.",
    colour: "none",
  },
  {
    id: "process",
    name: "Process",
    what: "Something happening over time, shown with white arrows: a pill breaking down, nutrients leaving, a hair loosening, cortisol rising.",
    composition: "The same cross-section with the process drawn mid-way and clean white arrows showing the direction, the arrows thin and few, the subject still centred.",
    motion: "The process advances along the arrows: pieces drift, particles travel, a strand loosens; the camera holds or pushes in very slowly.",
    colour: "white arrows",
  },
  {
    id: "problem",
    name: "Problem highlight",
    what: "The problem lit in red: inflammation dots, irritation, a hormone attacking, a blocked pore, swollen tissue.",
    composition: "The cross-section with the problem area glowing red: small red dots or a red haze around the subject, the rest of the tissue in its normal colours so the red reads as the only problem.",
    motion: "The red pulses and spreads a little; the subject strains under it; the camera holds.",
    colour: "red",
  },
  {
    id: "calm",
    name: "Calm",
    what: "The fix settling in, lit in green: a serum calming, an ingredient soothing, inflammation fading.",
    composition: "The same cross-section with a soft green glow at the base of the subject and, when the line names a product, drops or particles arriving from above; any red from before faded to a trace.",
    motion: "Drops slide down and the green glow grows and steadies; the red fades out; the camera holds.",
    colour: "green",
  },
  {
    id: "flow",
    name: "Ingredient flow",
    what: "An ingredient travelling to where it works, in blue: collagen into a root, berberine through the skin, ashwagandha reaching a cell.",
    composition: "Blue glowing particles entering at the top and flowing along thin white arrows down through the layers to the subject, pooling where they work; the subject centred, the path clear.",
    motion: "The particles stream along the arrows and gather at the destination; the glow there brightens; slow push-in.",
    colour: "blue",
  },
  {
    id: "split",
    name: "Split comparison",
    what: "Two states side by side: healthy versus damaged, before versus after, the pill route versus the patch route.",
    composition: "The frame divided down the middle by a thin vertical line: the same cross-section twice, left and right, differing only in the state (one healthy and lit, one damaged, grey and shrivelled, or one route versus the other), both centred in their half.",
    motion: "Almost still: the healthy side glows gently, the damaged side stays dull; the camera holds.",
    colour: "contrast",
  },
  {
    id: "comeback",
    name: "Comeback",
    what: "Life returning, in warm gold: a follicle waking, a cell lighting up, energy coming back, hair thickening.",
    composition: "The cross-section with the subject's core lit warm gold, a soft glow spreading outward, the subject fuller and healthier than before, no red anywhere.",
    motion: "The gold glow brightens and the subject fills out, thickens or straightens; slow push-in.",
    colour: "gold",
  },
];

export const moveById = (id: string | null | undefined): Move => MOVES.find((m) => m.id === id) ?? MOVES[0];

/** The style bible: every still, anchor included, starts from this. */
export const STYLE_LOOK =
  "Textbook medical illustration rendered in soft 3D: a clean anatomical cross-section, glossy but soft surfaces, even studio light, no harsh shadows. Fixed palette: peach-pink skin and tissue layers, cream-yellow fat cells, deep red vessels, a clear light sky-blue background behind the tissue block. Highlights carry meaning and nothing else is tinted: red for a problem, green for calm, blue for an ingredient, warm gold for a comeback, thin white arrows for movement. Plausible anatomy drawn simply enough to read in three seconds, never gory, no needles, no procedures, no faces.";

const FRAME = "Vertical 9:16, full-bleed, the tissue block fills the frame edge to edge with the subject centred and nothing important cropped at the sides. No text, no labels, no captions, no numbers, no logos, no watermark, no product bottles unless the scene asks for one.";

/**
 * A redraw of the anchor is a different take, not a re-roll: the marketer's
 * note when there is one, else the next of these, in turn. Each keeps the
 * palette and the cross-section but changes the render and the staging.
 */
export const ANCHOR_VARIATIONS = [
  "A more high-tech take: a cinematic 3D medical animation frame, shallow depth of field, soft volumetric light from above, the tissue block floating on the sky-blue background with a faint clean grid under it, fine glowing particles in the air, crisp micro-detail on every surface.",
  "A closer, more dramatic take: the camera much nearer the subject, which fills most of the frame, with a gentle rim light along its edge, the layers rendered with visible texture and translucency, the background a deeper gradient of the same sky blue.",
  "A cleaner, flatter take: wider framing showing more of the surrounding layers, matte surfaces with soft ambient occlusion, every structure outlined by a thin lighter edge the way a printed anatomy plate is, still rendered in 3D.",
  "A glassy premium take: the tissue block rendered like a polished museum model, glossy highlights, a thin reflective base plane, the subject lit like a product shot, the sky-blue background brighter at the top.",
];

/** The style anchor: the first beat's scene, drawn alone; every later still is drawn with it as the reference image. The take steers a redraw. */
export function anchorPrompt(scene: string, take?: string): string {
  const steer = take?.trim() ? `${take.trim()} ` : "";
  return `${STYLE_LOOK} ${scene.trim()} ${steer}${FRAME}`;
}

export function stillPrompt(scene: string, move: Move): string {
  return `${STYLE_LOOK} ${move.composition} ${scene.trim()} Same style, palette, lighting and render as the reference image; it is the same illustration set. ${FRAME}`;
}

export function motionPrompt(motion: string, move: Move): string {
  return `${motion.trim() || move.motion} Keep the exact textbook medical illustration style, palette and framing. Slow and smooth; no cuts, no text, no captions.`;
}

/** What Claude checks the still against before it is animated: the style, the subject, the colour code, stray text, cropping. */
export function checkPrompt(scene: string, move: Move): string {
  return [
    "You review a single still for a science b-roll set before it is animated. Pass it only when all of this holds:",
    "1. It is a textbook medical illustration cross-section in soft 3D: peach tissue layers, cream fat, red vessels, a light sky-blue background. Not a photo, not a dark glowing render, not a cartoon.",
    `2. It shows this subject, readable at a glance: ${scene.trim()}`,
    `3. The move is "${move.name}": ${move.composition} The highlight colour is ${move.colour}; no other tint competes with it.`,
    "4. There is no text, label, caption, number, logo or watermark anywhere, not even tiny or garbled letters.",
    "5. The subject is centred and whole; nothing important is cut off at the sides or top; no faces, no gore, no needles.",
    'Answer with JSON only: {"ok": boolean, "fix": string}. "fix" is one sentence telling the image model what to change when ok is false (the most important problem first), or "" when ok is true.',
  ].join("\n");
}

export function estimateCredits(input: { beats: Array<{ seconds: number }>; resolution: CartoonResolution }): number {
  let total = IMAGE_CREDITS; // the style anchor
  for (const b of input.beats) total += IMAGE_CREDITS + clipSecondsFor(b.seconds) * CLIP_CREDITS_PER_SECOND[input.resolution];
  return Math.round(total * 10) / 10;
}

/** Before Claude has planned: about one beat per sentence or every 14 words, 4 s each. */
export function roughEstimate(text: string, resolution: CartoonResolution): { beats: number; credits: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim()).length;
  const beats = Math.max(1, Math.min(MAX_BEATS, Math.max(sentences, Math.round(words / 14))));
  return { beats, credits: estimateCredits({ beats: Array.from({ length: beats }, () => ({ seconds: 4 })), resolution }) };
}
