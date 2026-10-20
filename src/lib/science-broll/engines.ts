import { CLIP_CREDITS_PER_SECOND, IMAGE_CREDITS, clipSecondsFor } from "@/lib/cartoon/engines";
import type { CartoonResolution } from "@/lib/cartoon/types";

/**
 * The Science B-roll skill: two looks (a style bible each), five scales a
 * set moves through, seven named moves (what happens in a shot), the
 * motion grammar, and the checks every still and the anchor must pass.
 * Runs on the Cartoon Hooks engines (Seedream 5.0 Flash stills, Seedance
 * 2.0 Mini clips) and the same Mac worker steps.
 */

export const MAX_BEATS = 10;
export const MAX_VARIANTS = 3;
/** Science beats are longer than cartoon beats: one idea, one slow move. */
export const MIN_BEAT_SECONDS = 3;
export const MAX_BEAT_SECONDS = 6;

// ─── Looks ───

export type LookId = "cinematic" | "plate";

export interface Look {
  id: LookId;
  name: string;
  blurb: string;
  /** The style bible every still of this look starts from. */
  bible: string;
  /** How the check describes the look it expects. */
  check: string;
  /** Different takes for an anchor redraw without a note, in turn. */
  variations: string[];
}

export const LOOKS: Look[] = [
  {
    id: "cinematic",
    name: "Cinematic 3D",
    blurb: "Photoreal medical animation: macro skin, cells, capillaries, blood, glowing molecules, lab-light bokeh",
    bible:
      "A frame from a photoreal cinematic 3D medical animation: macro lens, shallow depth of field, soft clinical light with a faintly blurred lab or clinic behind the subject. Tissue rendered with real texture and translucency: skin layers like stacked translucent cobblestone cells, capillaries as fine red and blue branching vessels, red blood cells as glossy biconcave discs, nerves and fat where they belong. Active ingredients and hormones are small glowing molecule clusters: green or blue for an ingredient, red or orange for a problem, warm gold for recovery. Natural tissue colours otherwise; the one highlight colour is the only tint. Surface shots are photoreal: real skin, a real patch, a real capsule, a real hand, no face. Plausible anatomy: every structure complete and attached, nothing floating, no stray tubes, no duplicate subjects. Never gory, no needles, no procedures.",
    check: "a photoreal cinematic 3D medical animation frame: macro depth of field, textured translucent tissue, fine red and blue capillaries, glossy blood cells, glowing molecule clusters, soft clinical light; not a flat textbook plate, not a cartoon, not a dark neon render",
    variations: [
      "A different take: closer still, the camera inside the tissue between the cells, the ingredient particles large in the foreground, everything else soft.",
      "A different take: a photoreal surface shot, the real skin and the product on it, the anatomy only ghosted faintly beneath the surface.",
      "A different take: wider and more structural, the full depth of the tissue from the surface down to the vessels, the camera level with the cut.",
      "A different take: inside a vessel, red blood cells tumbling past in warm light, the wall of the vessel curving around the frame.",
    ],
  },
  {
    id: "plate",
    name: "Textbook plate",
    blurb: "Clean anatomical cross-section on sky blue, soft 3D, highlights in red, green, blue and gold",
    bible:
      "Textbook medical illustration rendered in soft 3D: a clean anatomical cross-section, glossy but soft surfaces, even studio light, no harsh shadows. Fixed palette: peach-pink skin and tissue layers, cream-yellow fat cells, deep red vessels, a clear light sky-blue background behind the tissue block. Highlights carry meaning and nothing else is tinted: red for a problem, green for calm, blue for an ingredient, warm gold for a comeback, thin white arrows for movement. Plausible anatomy drawn simply enough to read in three seconds: every structure is complete and attached where it belongs; nothing floats, nothing is cut off mid-air, no stray tubes or fragments, no duplicate subjects. Never gory, no needles, no procedures, no faces.",
    check: "a textbook medical illustration cross-section in soft 3D: peach tissue layers, cream fat, red vessels, a light sky-blue background; not a photo, not a dark glowing render, not a cartoon",
    variations: [
      "A more high-tech take: a cinematic 3D medical animation frame, shallow depth of field, soft volumetric light from above, the tissue block floating on the sky-blue background with a faint clean grid under it, fine glowing particles in the air, crisp micro-detail on every surface.",
      "A closer, more dramatic take: the camera much nearer the subject, which fills most of the frame, with a gentle rim light along its edge, the layers rendered with visible texture and translucency, the background a deeper gradient of the same sky blue.",
      "A cleaner, flatter take: wider framing showing more of the surrounding layers, matte surfaces with soft ambient occlusion, every structure outlined by a thin lighter edge the way a printed anatomy plate is, still rendered in 3D.",
      "A glassy premium take: the tissue block rendered like a polished museum model, glossy highlights, a thin reflective base plane, the subject lit like a product shot, the sky-blue background brighter at the top.",
    ],
  },
];

export const DEFAULT_LOOK: LookId = "cinematic";
export const lookById = (id: string | null | undefined): Look => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

// ─── Scales: where the camera is. A set moves through them. ───

export type ScaleId = "surface" | "section" | "cellular" | "vessel" | "body";

export interface Scale {
  id: ScaleId;
  name: string;
  what: string;
  composition: string;
}

export const SCALES: Scale[] = [
  { id: "surface", name: "Surface", what: "The real world: skin, a patch, a capsule, a hand, a scalp from outside.", composition: "A photoreal close-up of the surface, the product or the body part filling the frame, no face, the anatomy beneath at most faintly ghosted through the skin." },
  { id: "section", name: "Cross-section", what: "The tissue cut open: skin layers, a scalp with a follicle, a gut wall, the stomach lining.", composition: "The tissue cut open and seen from the side, the layers stacked top to bottom, the one subject centred, vessels and fat where they belong." },
  { id: "cellular", name: "Between the cells", what: "Inside the tissue at cell scale: cobblestone cells, molecules passing between them, a follicle root, a receptor.", composition: "The camera between the cells, which fill the frame as translucent stacked shapes, the particles or the subject large in the foreground, depth falling off softly." },
  { id: "vessel", name: "Inside a vessel", what: "Inside a capillary or vein: red blood cells, the vessel wall, what travels in the blood.", composition: "Inside the vessel, its wall curving around the frame, red blood cells tumbling past, the subject carried in the flow." },
  { id: "body", name: "Whole body", what: "The whole system: a translucent figure with its vessels, organs or skin lit where the story is.", composition: "A translucent full-body figure, no face detail, standing centred, the circulatory system or the organ in question lit, the rest faint." },
];

export const scaleById = (id: string | null | undefined): Scale => SCALES.find((s) => s.id === id) ?? SCALES[1];

// ─── Moves: what happens in the shot. ───

export type MoveId = "cross_section" | "process" | "problem" | "calm" | "flow" | "split" | "comeback";

export interface Move {
  id: MoveId;
  name: string;
  what: string;
  composition: string;
  motion: string;
  colour: string;
}

export const MOVES: Move[] = [
  { id: "cross_section", name: "Establish", what: "Showing where we are before anything happens: the surface, the tissue, the vessel, the body.", composition: "The subject shown plainly, nothing highlighted yet, every structure readable.", motion: "The camera glides in slowly; a vessel pulses; nothing else moves.", colour: "none" },
  { id: "process", name: "Process", what: "Something happening over time: a patch releasing, a pill breaking down, a hair loosening, a hormone rising.", composition: "The process drawn mid-way, the direction of travel clear from the particles or the shapes themselves (thin white arrows only in the textbook look).", motion: "The process advances: particles travel, pieces drift, a strand loosens, a release spreads; the camera glides slowly along the direction of travel.", colour: "white arrows or the particles' own colour" },
  { id: "problem", name: "Problem", what: "The problem lit in red or orange: inflammation, a hormone attacking, a blockage, swollen tissue.", composition: "The problem area glowing red or orange, red particles or haze around the subject, the rest in natural colours so the highlight reads as the only problem.", motion: "The red pulses and spreads a little; the subject strains under it; the camera holds or pushes in slightly.", colour: "red" },
  { id: "calm", name: "Calm", what: "The fix settling in, lit in green: a serum calming, an ingredient soothing, inflammation fading.", composition: "A soft green glow at the subject, green molecules arriving, any red from before faded to a trace.", motion: "The green particles arrive and the glow grows and steadies; the red fades out; the camera holds.", colour: "green" },
  { id: "flow", name: "Ingredient flow", what: "An ingredient travelling to where it works: through the skin, between the cells, into the capillary, with the blood.", composition: "Glowing blue or green molecule clusters entering from one side and travelling through the subject toward their destination, the path clear.", motion: "The molecules stream along the path and gather at the destination; the glow there brightens; the camera glides with them.", colour: "blue or green" },
  { id: "split", name: "Split comparison", what: "Two states side by side: healthy versus damaged, before versus after, the pill route versus the patch route.", composition: "The frame divided down the middle by a thin vertical line: the same subject twice, left and right, differing only in the state, both centred in their half.", motion: "Almost still: the healthy side glows gently, the other side stays dull; the camera holds.", colour: "contrast" },
  { id: "comeback", name: "Comeback", what: "Life returning, in warm gold: a follicle waking, a cell lighting up, energy coming back, tissue healing.", composition: "The subject's core lit warm gold, a soft glow spreading outward, the subject fuller and healthier than before, no red anywhere.", motion: "The gold glow brightens and the subject fills out, thickens or straightens; slow push-in.", colour: "gold" },
];

export const moveById = (id: string | null | undefined): Move => MOVES.find((m) => m.id === id) ?? MOVES[0];

// ─── Prompts ───

const FRAME = "Vertical 9:16, full-bleed, the subject centred and whole with nothing important cropped at the sides. No text, no labels, no captions, no numbers, no logos, no watermark, no faces.";

/** The anchor shows the subject at rest: it sets the look, the beats add what happens. */
const AT_REST = "The subject at rest with nothing happening: no particles, no drops, no glow, no highlight anywhere, no arrows. Few elements, each one readable, all complete and attached.";

/** The style anchor: the set's hero subject at rest, drawn alone; every later still is drawn with it as the style reference. The take steers a redraw. */
export function anchorPrompt(scene: string, look: Look, take?: string): string {
  const steer = take?.trim() ? `${take.trim()} ` : "";
  return `${look.bible} ${scene.trim()} ${AT_REST} ${steer}${FRAME}`;
}

/**
 * A beat's still. The anchor rides along as the reference image for its
 * render, palette and lighting only; the composition follows the scale and
 * the scene, so a set can move from the surface to a vessel without every
 * frame collapsing back into the anchor's framing.
 */
export function stillPrompt(scene: string, move: Move, scale: Scale, look: Look): string {
  return `${look.bible} ${scale.composition} ${move.composition} ${scene.trim()} The reference image shows this set's render, palette and lighting: match those exactly, but take the composition, the camera distance and the subject from this description, not from the reference. ${FRAME}`;
}

export function motionPrompt(motion: string, move: Move, look: Look): string {
  const keep = look.id === "cinematic" ? "Keep the exact photoreal cinematic 3D medical animation look, lighting and depth of field." : "Keep the exact textbook medical illustration style, palette and framing.";
  return `${motion.trim() || move.motion} ${keep} Slow and smooth camera, no cuts, no text, no captions.`;
}

/** What Claude checks a still against before it is animated: the look, the scale, the subject, the colour code, stray text, cropping. */
export function checkPrompt(scene: string, move: Move, scale: Scale, look: Look): string {
  return [
    "You review a single still for a science b-roll set before it is animated. Pass it only when all of this holds:",
    `1. It is ${look.check}.`,
    `2. The camera is at this scale, "${scale.name}": ${scale.composition}`,
    `3. It shows this subject, readable at a glance: ${scene.trim()}`,
    `4. The move is "${move.name}": ${move.composition} The highlight colour is ${move.colour}; no other tint competes with it.`,
    "5. The anatomy is coherent: every structure complete and attached; no vessel, tube or fragment floating or ending mid-air; no duplicate subject.",
    "6. There is no text, label, caption, number, logo or watermark anywhere, not even tiny or garbled letters; no faces, no gore, no needles; the subject is centred and whole.",
    'Answer with JSON only: {"ok": boolean, "fix": string}. "fix" is one sentence telling the image model what to change when ok is false (the most important problem first), or "" when ok is true.',
  ].join("\n");
}

/** What Claude checks the anchor against before the marketer sees it: the look, coherent anatomy, nothing happening. */
export function anchorCheckPrompt(scene: string, look: Look): string {
  return [
    "You review the style anchor of a science b-roll set: the one still every other still will be matched to for render, palette and lighting. Pass it only when all of this holds:",
    `1. It is ${look.check}.`,
    `2. It shows this subject at rest, readable at a glance: ${scene.trim()}`,
    "3. The anatomy is coherent: every structure is complete and attached where it belongs; no vessel, tube or fragment floats in the air, starts from nowhere or ends mid-air; no duplicated subject.",
    "4. Nothing is happening: no arrows, particles, drops, glows or coloured highlights; no product unless the subject is the product on the skin.",
    "5. No text, label, caption, number, logo or watermark anywhere; the subject centred and whole; no faces, no gore.",
    'Answer with JSON only: {"ok": boolean, "fix": string}. "fix" is one sentence for the image model on what to change when ok is false (name the floating or incoherent part first), or "" when ok is true.',
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
