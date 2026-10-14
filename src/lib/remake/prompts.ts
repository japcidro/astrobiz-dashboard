import { makeRecipe, resolveLook, type LookId, type SwapRecipe } from "@/lib/hook-studio/presets";

/**
 * Prompts for the Nano Banana Pro still and for the lipsync clips. The
 * still prompt follows the UGC Generator's swap prompt, then adds the brand
 * part: our product (from the brand kit photos) replaces whatever the
 * reference was selling, and competitor text or logos go away.
 */

export function castRecipe(look: LookId): SwapRecipe {
  return makeRecipe(resolveLook(look, 0));
}

export interface StillPromptInput {
  recipe: SwapRecipe;
  /** True when a cast image is attached: keep that person, don't invent one. */
  hasCast: boolean;
  /** Number of product photos attached after the frame (and cast). */
  productImages: number;
  brandRules: string;
  castNote: string;
  shotDescription: string | null;
}

export function stillPrompt(i: StillPromptInput): string {
  const who = i.hasCast
    ? `Replace the person in the first image with the exact person shown in the second image (same face, hair, skin and body), keeping the second image's identity faithfully.`
    : `Replace the person in the first image with a completely different person who looks nothing like the original: ${i.recipe.who} of the same gender with ${i.recipe.skin}, ${i.recipe.hairColor} hair styled as ${i.recipe.hairCut}, ${i.recipe.eyes} eyes, and a different face shape, nose, lips, eyebrows and jawline. Attractive, fit and toned, healthy glowing skin, well groomed.`;
  const product =
    i.productImages > 0
      ? ` The remaining ${i.productImages === 1 ? "image is our product" : `${i.productImages} images are our product`}: replace the product, bottle, box or packaging the person holds or shows with our product exactly as it appears in those photos (same shape, colors, label and text), at the same position, angle and scale, held the same way.`
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

/** What the lipsync engines are told. The audio carries the words. */
export function speakPrompt(shotDescription: string | null): string {
  const scene = shotDescription?.trim() ? ` Scene: ${shotDescription.trim()}.` : "";
  return (
    `The person in the image talks to the camera, speaking the attached audio with natural lip sync, ` +
    `small natural head movements, blinks and expressions, relaxed and conversational, as if recording a selfie video on a phone.${scene} ` +
    `Keep the person, clothing, room, framing and lighting exactly as in the image. Handheld phone-camera look, natural grain. ` +
    `No on-screen text, no captions, no subtitles.`
  );
}

/** Motion transfer: keep the still, copy the real shot. */
export function motionPrompt(shotDescription: string | null): string {
  const scene = shotDescription?.trim() ? ` The action: ${shotDescription.trim()}.` : "";
  return (
    `Keep the person, clothing, product, room and framing exactly as in the image. Copy the reference video's camera movement, action and timing; nothing else changes.${scene} ` +
    `No speech, no lip movement, no on-screen text, no captions. Vertical 9:16, phone-camera look, natural grain.`
  );
}
