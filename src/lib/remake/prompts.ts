import { makeRecipe, resolveLook, type LookId, type SwapRecipe } from "@/lib/hook-studio/presets";

/**
 * Prompts for the Nano Banana Pro still and for the clip engines. The still
 * prompt follows the UGC Generator's swap prompt, then adds the brand part:
 * our product (from the brand kit photos) replaces whatever the reference
 * was selling, and competitor text or logos go away.
 */

export function castRecipe(look: LookId): SwapRecipe {
  return makeRecipe(resolveLook(look, 0));
}

export interface StillPromptInput {
  recipe: SwapRecipe;
  /** True when a cast image is attached: keep that person, don't invent one. */
  hasCast: boolean;
  /** Product photos attached after the frame (and cast), in order. */
  products: Array<{ kind: string | null; description: string | null }>;
  /** What the person holds in the reference frame, when known. */
  holds: string | null;
  brandRules: string;
  castNote: string;
  shotDescription: string | null;
}

export function stillPrompt(i: StillPromptInput): string {
  const who = i.hasCast
    ? `Replace the person in the first image with the exact person shown in the second image (same face, hair, skin and body), keeping the second image's identity faithfully.`
    : `Replace the person in the first image with a completely different person who looks nothing like the original: ${i.recipe.who} of the same gender with ${i.recipe.skin}, ${i.recipe.hairColor} hair styled as ${i.recipe.hairCut}, ${i.recipe.eyes} eyes, and a different face shape, nose, lips, eyebrows and jawline. Attractive, fit and toned, healthy glowing skin, well groomed.`;
  const firstProduct = i.hasCast ? 3 : 2;
  const list = i.products
    .map((p, n) => `image ${firstProduct + n} shows our ${p.kind && p.kind !== "other" ? p.kind : "product"}${p.description ? ` (${p.description})` : ""}`)
    .join("; ");
  const held = i.holds && i.holds !== "none" ? i.holds : null;
  const product =
    i.products.length > 0
      ? ` The remaining ${i.products.length === 1 ? "image is" : "images are"} our own product: ${list}. ${
          held
            ? `The person holds ${/^[aeiou]/.test(held) ? "an" : "a"} ${held} in the frame: replace it with our ${held} from those photos`
            : "Replace whatever product, bottle, box, pieces or packaging the person holds or shows with the matching form of our product from those photos"
        }, exactly as it appears there (same shape, colors, label and text), at the same position and angle and held the same way, but at the product's true real-world size relative to the person's hands and face: a supplement bottle or jar is palm-sized, the fingers wrap most of the way around it; a box or sachet is no bigger than a hand. Never enlarge the product to fill the frame. Do not change the kind of object: a bottle stays a bottle, loose gummies stay loose gummies, a box stays a box. ` +
          `Copy the label from the product photo letter for letter: the brand name, product name and every line of text must be sharp, legible and spelled exactly as in the photo, with no invented, reworded, missing or extra words and no gibberish letters; small print stays faint small print rather than made-up characters.`
      : ` Remove or blur any brand name, logo or label on products in the frame so no competitor branding is visible.`;
  const rules = i.brandRules.trim() ? ` Brand rules: ${i.brandRules.trim()}.` : "";
  const note = i.castNote.trim() ? ` Also: ${i.castNote.trim()}.` : "";
  const scene = i.shotDescription?.trim() ? ` The shot shows: ${i.shotDescription.trim()}.` : "";
  return (
    `${who}${product} Keep the exact same pose, head angle, hand positions and facial expression, the same clothing, framing and crop, the same background, furniture, props, lighting and time of day.${scene} ` +
    `Remove every piece of text, caption, subtitle, sticker, emoji, watermark, logo, icon, button, progress bar and app interface anywhere in the frame, and rebuild the background behind them so nothing looks erased, except the text printed on our own product. ` +
    `The output is a clean photograph, photoreal, candid phone-camera look with natural skin texture, 9:16.${rules}${note}`
  );
}

const PHONE_LOOK = `Keep the person, clothing, product, room, framing and lighting exactly as in the image. Handheld phone-camera look, natural grain, natural skin. No on-screen text, no captions, no subtitles, no logos.`;

/**
 * Veo: the still comes alive and, when there is a script, the person says
 * it. Veo makes the voice and the lip movement itself.
 */
export function veoPrompt(i: { script: string; voiceDirection: string; shotDescription: string | null; kind: "talking_head" | "broll" }): string {
  const scene = i.shotDescription?.trim() ? ` ${i.shotDescription.trim()}.` : "";
  const script = i.script.trim().replace(/"/g, "'");
  if (script) {
    const voice = i.voiceDirection.trim() ? `in a ${i.voiceDirection.trim()} voice` : "in a warm, casual, conversational voice";
    return (
      `Vertical 9:16 selfie-style video.${scene} The person looks at the camera and says ${voice}, with natural lip sync, small head movements, blinks and expressions: "${script}" ` +
      `Only this person speaks; no other voices, no music, quiet room ambience. ${PHONE_LOOK}`
    );
  }
  return `Vertical 9:16 video.${scene} ${i.kind === "talking_head" ? "The person moves naturally, glances at the product and back at the camera, no speech." : "Natural small motion in the scene, hands and product move as a real clip would, no speech."} Quiet natural ambience, no music. ${PHONE_LOOK}`;
}

/** Motion transfer: keep the still, copy the real clip. */
export function motionPrompt(shotDescription: string | null): string {
  const scene = shotDescription?.trim() ? ` The action: ${shotDescription.trim()}.` : "";
  return `Keep the person, clothing, product, room and framing exactly as in the image. Copy the reference video's camera movement, action and timing; nothing else changes.${scene} No speech, no lip movement, no on-screen text, no captions. Vertical 9:16, phone-camera look, natural grain.`;
}
