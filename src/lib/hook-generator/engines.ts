import type { BeatKind, ImageModel, RefRole, VideoModel } from "./types";

/**
 * Hook Generator models and prompts. The worker (worker/hook-worker.mjs,
 * hookgen*) mirrors the CLI arguments; keep the two in step. Credits from
 * `higgsfield generate cost` on 2026-10-16.
 */

export const IMAGE_MODELS: Array<{ id: ImageModel; name: string; credits: number; blurb: string }> = [
  { id: "seedream_5_0_flash", name: "Seedream 5 Flash", credits: 0.5, blurb: "Cheapest; good enough to judge the idea" },
  { id: "nano_banana_pro", name: "Nano Banana Pro", credits: 2, blurb: "Keeps faces from the references closer" },
];

export const VIDEO_MODELS: Array<{ id: VideoModel; name: string; blurb: string }> = [
  { id: "veo3_1", name: "Veo 3.1 Fast", blurb: "Talks: says the line with its own voice and lips" },
  { id: "seedance_2_0_mini", name: "Seedance 2.0 Mini", blurb: "Silent and cheapest; add the voice in CapCut" },
];

/** Veo 3.1 Fast: 4 credits a second, 4, 6 or 8 seconds. Seedance 2.0 Mini at 480p: 0.5 a second, 4 to 15. */
export const VEO_LENGTHS = [4, 6, 8];
const CLIP_CREDITS_PER_SECOND: Record<VideoModel, number> = { veo3_1: 4, seedance_2_0_mini: 0.5 };

export const MAX_REFS = 6;
export const MAX_VARIANTS = 4;

export const imageCredits = (m: ImageModel) => IMAGE_MODELS.find((x) => x.id === m)?.credits ?? 0.5;

export const REF_ROLES: Array<{ id: RefRole; name: string }> = [
  { id: "expert", name: "Expert" },
  { id: "client", name: "Client" },
  { id: "setting", name: "Setting" },
  { id: "product", name: "Product" },
  { id: "style", name: "Look" },
];

/**
 * The head-tap moves: each one is a beat of the hook. A hand on the head is
 * the scroll stopper, so every beat has one and the clip is checked for it.
 */
export const BEAT_KINDS: Array<{ id: BeatKind; name: string; scene: string; motion: string }> = [
  {
    id: "crown_pat",
    name: "Point and pat the crown",
    scene: "The client sits with their back to the camera so the top and crown of the head fill the lower part of the frame, the thin spot clearly visible. The expert stands beside the client, half-turned to the camera, one hand pointing at the thin spot.",
    motion: "The expert taps the thin spot on the client's crown twice with two fingers, then pats it with a flat hand, looking into the camera while talking.",
  },
  {
    id: "part_hair",
    name: "Part hair to show scalp",
    scene: "The client faces the camera, eyes down. The expert stands behind the client and parts the hair down the middle with both hands, the scalp along the part clearly visible.",
    motion: "The expert's fingers spread the parting wider and press lightly on the scalp to show how thin it is, looking into the camera while talking.",
  },
  {
    id: "lift_strands",
    name: "Lift thin strands",
    scene: "The expert holds up a few thin strands of the client's hair between two fingers, toward the camera, so the thinness shows.",
    motion: "The expert lifts the thin strands, lets them fall, and lifts them again, looking into the camera while talking.",
  },
  {
    id: "hairline_tap",
    name: "Tap the hairline",
    scene: "The client faces the camera. The expert's fingertips touch the client's thin hairline and temples.",
    motion: "The expert taps along the client's hairline and temples with the fingertips, looking into the camera while talking.",
  },
];

export const beatKindName = (k: string) => BEAT_KINDS.find((b) => b.id === k)?.name ?? k;
export const isBeatKind = (v: unknown): v is BeatKind => BEAT_KINDS.some((b) => b.id === v);
export const DEFAULT_BEATS: BeatKind[] = ["crown_pat"];

const words = (line: string) => line.trim().split(/\s+/).filter(Boolean).length;

/** How long the beat stays in the hook: the line at about 2.6 words a second, or 2 seconds when nothing is said. */
export function beatSeconds(line: string): number {
  const s = line.trim() ? words(line) / 2.6 + 0.3 : 2;
  return Math.round(Math.min(7.5, Math.max(1.5, s)) * 10) / 10;
}

/** What the video model is asked for: Veo's shortest length that fits the line; Seedance's 4 to 15 seconds. */
export function clipSecondsFor(model: VideoModel, seconds: number): number {
  if (model === "veo3_1") return VEO_LENGTHS.find((l) => l >= seconds + 0.5) ?? 8;
  return Math.min(15, Math.max(4, Math.ceil(seconds + 0.3)));
}

export const clipCredits = (model: VideoModel, clipSeconds: number) => CLIP_CREDITS_PER_SECOND[model] * clipSeconds;

/** Before Claude has planned: every beat as a 4-second clip. */
export function estimateCredits(input: { beats: number; image: ImageModel; video: VideoModel }): { stills: number; total: number } {
  const stills = input.beats * imageCredits(input.image);
  return { stills, total: Math.round((stills + input.beats * clipCredits(input.video, 4)) * 10) / 10 };
}

const PHOTO = "Photorealistic vertical 9:16 smartphone photo, candid UGC look, real skin texture and hair detail, natural indoor light, sharp focus. No text, no captions, no letters, no logos, no watermark.";

const ROLE_TEXT: Record<RefRole, string> = {
  expert: "the expert (keep the same face, hair, skin tone, build and outfit)",
  client: "the client (keep the same face, hair color and hair thinning)",
  setting: "the setting (use this room, its furniture, colors and light)",
  product: "the product (if it appears, it is this exact product with its label unchanged)",
  style: "a look reference (match its light, colors and camera feel, not its people)",
};

/** The starting image: Claude's scene, the hand already on the head, which reference is who, and the latest fix. */
export function stillPrompt(scene: string, roles: RefRole[], fix: string): string {
  const refs = roles.length ? ` Reference images, in order: ${roles.map((r, i) => `image ${i + 1} is ${ROLE_TEXT[r]}`).join("; ")}.` : "";
  const change = fix.trim() ? ` Change from the last attempt: ${fix.trim()}.` : "";
  return `${scene.trim()} In this frame the expert's hand is already on or touching the client's head or hair.${refs}${change} ${PHOTO}`;
}

const KEEP = "Keep the people, clothing, room, framing and light exactly as in the image. Handheld phone-camera look, natural grain. No on-screen text, no captions, no subtitles, no logos.";
const TOUCH = "The expert's hand visibly touches the client's hair or scalp during the clip: taps, pats or parts it.";

/** The clip: the head-tap move, and for Veo the exact words in the voice Claude described. */
export function motionPrompt(i: { motion: string; line: string; voice: string; model: VideoModel }): string {
  const line = i.line.trim().replace(/"/g, "'");
  if (i.model === "veo3_1" && line) {
    const voice = i.voice.trim() || "a natural adult voice that matches the expert";
    return (
      `Vertical 9:16 smartphone video. ${i.motion.trim()} ${TOUCH} The expert looks into the camera and says, with natural lip sync (voice: ${voice}): "${line}" ` +
      `Say exactly these words, nothing added. Only the expert speaks; no other voices, no music, quiet room ambience. ${KEEP}`
    );
  }
  return `Vertical 9:16 smartphone video. ${i.motion.trim()} ${TOUCH} The expert looks into the camera and talks naturally. No music. ${KEEP}`;
}
