/**
 * Prompt for the UGC Generator: swap the person in a still for a genuinely
 * new one and return a pure photo.
 *
 * Learned on 2026-09-28: an editing model keeps the face unless the
 * instruction makes the difference concrete. "A Latina with straight dark
 * hair" matched the source woman, so nothing changed. Each image therefore
 * gets a *recipe* of specific traits (hair cut, hair colour, eye colour,
 * skin shade) drawn from the chosen look's pools, and the prompt says the
 * new person must look nothing like the original. The swap is the first
 * instruction; the clean-frame rule (no text, icons or app UI) is absolute.
 *
 * The audience is the US. The default look is "Varied": each image in a
 * batch gets a different look from the US mix. Hair is straight or softly
 * wavy in every look.
 */

interface LookPools {
  who: string;
  skin: string[];
  hairColor: string[];
}

export const LOOKS = [
  { id: "varied", label: "Varied (US mix)" },
  { id: "caucasian", label: "Caucasian" },
  { id: "latina", label: "Latina / Latino" },
  { id: "asian_american", label: "Asian American" },
  { id: "mediterranean", label: "Mediterranean / Middle Eastern" },
  { id: "filipina", label: "Filipina / Filipino" },
] as const;

export type LookId = (typeof LOOKS)[number]["id"];
export type ConcreteLook = Exclude<LookId, "varied">;
export const DEFAULT_LOOK: LookId = "varied";

/** The looks "Varied" rotates through so a batch never repeats one. */
export const VARIED_POOL: ConcreteLook[] = ["caucasian", "latina", "asian_american", "mediterranean"];

const POOLS: Record<ConcreteLook, LookPools> = {
  caucasian: {
    who: "an American Caucasian person",
    skin: ["fair, lightly freckled skin", "fair skin with a light summer tan", "pale porcelain skin"],
    hairColor: ["honey blonde", "platinum blonde", "light brown", "auburn", "copper red", "ash brown"],
  },
  latina: {
    who: "an American Latina or Latino person",
    skin: ["warm caramel skin", "golden tan skin", "light olive skin"],
    hairColor: ["dark brown", "espresso brown", "chestnut brown with caramel highlights", "jet black"],
  },
  asian_american: {
    who: "an Asian American person",
    skin: ["fair porcelain skin", "light golden skin", "warm beige skin"],
    hairColor: ["jet black", "dark brown", "black with a soft brown tint"],
  },
  mediterranean: {
    who: "an American person of Mediterranean or Middle Eastern background",
    skin: ["olive skin", "warm bronze skin", "light olive skin"],
    hairColor: ["dark brown", "black", "deep chestnut brown"],
  },
  filipina: {
    who: "a Filipina or Filipino person",
    skin: ["light-tan skin", "golden-brown skin", "warm morena skin"],
    hairColor: ["jet black", "dark brown", "black with a chestnut tint"],
  },
};

/** Cuts shared by every look. Straight or softly wavy only. */
const HAIR_CUTS = [
  "long straight hair worn down",
  "a sleek chin-length bob",
  "a high sleek ponytail",
  "shoulder-length softly wavy hair",
  "a short pixie cut",
  "long hair in a loose low bun",
  "a middle-parted long layered cut",
  "a collarbone-length blunt cut",
];

const EYE_COLORS = ["dark brown", "hazel", "green", "blue", "light brown", "grey-blue"];

const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

export function isLookId(id: unknown): id is LookId {
  return typeof id === "string" && LOOKS.some((l) => l.id === id);
}

/** Resolve "varied" to a concrete look for the i-th image of a batch. */
export function resolveLook(look: LookId, index: number, start: number = Math.floor(Math.random() * VARIED_POOL.length)): ConcreteLook {
  if (look !== "varied") return look;
  return VARIED_POOL[(start + index) % VARIED_POOL.length];
}

export interface SwapRecipe {
  look: ConcreteLook;
  who: string;
  skin: string;
  hairCut: string;
  hairColor: string;
  eyes: string;
}

/** Concrete traits for one image, different every call. */
export function makeRecipe(look: ConcreteLook): SwapRecipe {
  const p = POOLS[look];
  return { look, who: p.who, skin: pick(p.skin), hairCut: pick(HAIR_CUTS), hairColor: pick(p.hairColor), eyes: pick(EYE_COLORS) };
}

export function recipeSummary(rec: SwapRecipe): string {
  return `${rec.hairColor} hair, ${rec.hairCut}, ${rec.eyes} eyes, ${rec.skin}`;
}

export function ugcSwapPrompt(note: string, rec: SwapRecipe): string {
  const extra = note.trim() ? ` Also: ${note.trim()}.` : "";
  return (
    `Replace the person in this photo with a completely different person who looks nothing like ` +
    `the original: ${rec.who} of the same gender (a woman stays a woman, a man stays a man) with ` +
    `${rec.skin}, ${rec.hairColor} hair styled as ${rec.hairCut}, ${rec.eyes} eyes, and a different ` +
    `face shape, nose, lips, eyebrows and jawline, so nobody could mistake them for the original. ` +
    `Attractive, fit and toned, healthy glowing skin, well groomed, photogenic. ` +
    `Keep the exact same pose, head angle, hand positions and facial expression, the same clothing, ` +
    `the same framing and crop, the same background, furniture, equipment, props, lighting and time ` +
    `of day. ` +
    `Also remove every piece of text, caption, subtitle, sticker, emoji, watermark, logo, icon, ` +
    `button, progress bar, play control and app interface anywhere in the frame, and rebuild the ` +
    `background behind them so nothing looks erased. The output is a clean photograph with no text ` +
    `of any kind. Photoreal, candid phone-camera look with natural skin texture.${extra}`
  );
}
