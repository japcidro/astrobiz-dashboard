/**
 * Prompt for the UGC Generator: swap the person in a still and return a
 * pure photo, nothing else.
 *
 * Rule one is the clean frame: every caption, sticker, emoji, watermark,
 * logo, icon, button, progress bar and app-interface element in the source
 * is removed and the background behind it rebuilt. Rule two is the person:
 * same gender, a new face, attractive and fit, in the chosen look. Pose,
 * expression, clothing, framing and background stay.
 *
 * The audience is the US. The default is "Varied": each image in a batch
 * gets a different look from the US mix below, so a set of four comes back
 * as four different people. A specific look is a choice, never the default.
 * Looks are stated positively (who the new person is); image models follow
 * that far better than a list of things to avoid. Hair is straight or
 * softly wavy in every look.
 */

export const LOOKS = [
  {
    id: "varied",
    label: "Varied (US mix)",
    prompt: "",
  },
  {
    id: "caucasian",
    label: "Caucasian",
    prompt: "an American Caucasian person with fair to lightly tanned skin and straight or softly wavy brown, blonde or auburn hair",
  },
  {
    id: "latina",
    label: "Latina / Latino",
    prompt: "an American Latina or Latino person with warm tan skin and straight or softly wavy dark brown hair",
  },
  {
    id: "asian_american",
    label: "Asian American",
    prompt: "an Asian American person with fair to light-tan skin and straight or softly wavy black or dark brown hair",
  },
  {
    id: "mediterranean",
    label: "Mediterranean / Middle Eastern",
    prompt: "an American person of Mediterranean or Middle Eastern background with olive skin and straight or softly wavy dark hair",
  },
  {
    id: "filipina",
    label: "Filipina / Filipino",
    prompt: "a Filipina or Filipino person with light-tan to golden-brown skin and straight or softly wavy dark hair",
  },
] as const;

export type LookId = (typeof LOOKS)[number]["id"];
export const DEFAULT_LOOK: LookId = "varied";

/** The looks "Varied" rotates through, in order, so a batch never repeats one. */
export const VARIED_POOL: LookId[] = ["caucasian", "latina", "asian_american", "mediterranean"];

export function isLookId(id: unknown): id is LookId {
  return typeof id === "string" && LOOKS.some((l) => l.id === id);
}

/** Resolve "varied" to a concrete look for the i-th image of a batch. */
export function resolveLook(look: LookId, index: number): LookId {
  if (look !== "varied") return look;
  // Start at a random point so two batches of one don't always get the same look.
  const start = Math.floor(Math.random() * VARIED_POOL.length);
  return VARIED_POOL[(start + index) % VARIED_POOL.length];
}

export function lookPrompt(id: string): string {
  const found = LOOKS.find((l) => l.id === id);
  return found && found.prompt ? found.prompt : LOOKS.find((l) => l.id === VARIED_POOL[0])!.prompt;
}

export function ugcSwapPrompt(note: string, look: string = VARIED_POOL[0]): string {
  const extra = note.trim() ? ` Also: ${note.trim()}.` : "";
  return (
    `Edit this photo and return a pure photograph: no text, no captions, no subtitles, no ` +
    `stickers, no emojis, no watermarks, no logos, no icons, no buttons, no progress bars, no ` +
    `play controls, no app interface of any kind. Remove all of those wherever they appear and ` +
    `rebuild the background behind them so nothing looks erased or blurred. ` +
    `Then replace the person with a completely different person of the same gender (a woman ` +
    `stays a woman, a man stays a man): ${lookPrompt(look)}, with a new face that does not ` +
    `resemble the original, attractive, fit and toned, healthy glowing skin, well groomed, ` +
    `photogenic, hair neatly styled. ` +
    `Keep everything else exactly as it is: the same pose, hand positions and facial expression, ` +
    `the same clothing, the same framing and crop, the same background, furniture, equipment, ` +
    `props, lighting and time of day. Photoreal, candid phone-camera look with natural skin ` +
    `texture.${extra}`
  );
}
