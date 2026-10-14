/**
 * Prompts for the UGC Generator: swap the person in a still for a genuinely
 * new one and return a pure photo, or make the photo from text alone.
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
 *
 * 2026-10-15: gender is a choice. "Same as photo" keeps whatever the source
 * shows (the old behaviour); "Woman" / "Man" force it, which also lets a
 * male model replace a female one. Without a source photo the note is the
 * whole brief and the recipe plus a default scene make a UGC-style still.
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

export const GENDERS = [
  { id: "keep", label: "Same as photo" },
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
] as const;

export type GenderId = (typeof GENDERS)[number]["id"];
export const DEFAULT_GENDER: GenderId = "keep";

export function isGenderId(id: unknown): id is GenderId {
  return typeof id === "string" && GENDERS.some((g) => g.id === id);
}

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
const HAIR_CUTS_WOMAN = [
  "long straight hair worn down",
  "a sleek chin-length bob",
  "a high sleek ponytail",
  "shoulder-length softly wavy hair",
  "a short pixie cut",
  "long hair in a loose low bun",
  "a middle-parted long layered cut",
  "a collarbone-length blunt cut",
];

const HAIR_CUTS_MAN = [
  "a short textured crop",
  "a clean side part with a low fade",
  "short hair swept back off the forehead",
  "a medium-length cut, softly wavy, pushed back",
  "a neat buzz cut",
  "a short quiff",
  "a tidy crew cut",
  "a medium cut parted in the middle, tucked behind the ears",
];

/** With "Same as photo" the gender is unknown, so the cut is described loosely. */
const HAIR_CUT_KEEP = "a clearly different hairstyle from the original, straight or softly wavy, suited to their gender";

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
  gender: GenderId;
  who: string;
  skin: string;
  hairCut: string;
  hairColor: string;
  eyes: string;
}

/** Concrete traits for one image, different every call. */
export function makeRecipe(look: ConcreteLook, gender: GenderId = DEFAULT_GENDER): SwapRecipe {
  const p = POOLS[look];
  const hairCut = gender === "man" ? pick(HAIR_CUTS_MAN) : gender === "woman" ? pick(HAIR_CUTS_WOMAN) : HAIR_CUT_KEEP;
  return { look, gender, who: p.who, skin: pick(p.skin), hairCut, hairColor: pick(p.hairColor), eyes: pick(EYE_COLORS) };
}

export function recipeSummary(rec: SwapRecipe): string {
  const g = rec.gender === "keep" ? "" : `${rec.gender}, `;
  return `${g}${rec.hairColor} hair, ${rec.hairCut}, ${rec.eyes} eyes, ${rec.skin}`;
}

/** "an American Caucasian person" → "an American Caucasian man" when the gender is set. */
function whoWithGender(rec: SwapRecipe): string {
  if (rec.gender === "keep") return rec.who;
  const g = rec.gender;
  if (rec.look === "latina") return g === "man" ? "an American Latino man" : "an American Latina woman";
  if (rec.look === "filipina") return g === "man" ? "a Filipino man" : "a Filipina woman";
  return rec.who.replace(/\bperson\b/, g);
}

const AGE = ["mid 20s", "late 20s", "early 30s", "mid 30s"];
const ageOf = (rec: SwapRecipe) => `in ${rec.gender === "man" ? "his" : rec.gender === "woman" ? "her" : "their"} ${pick(AGE)}`;

export function ugcSwapPrompt(note: string, rec: SwapRecipe): string {
  const extra = note.trim() ? ` Also: ${note.trim()}.` : "";
  const gender =
    rec.gender === "keep"
      ? `${rec.who} of the same gender (a woman stays a woman, a man stays a man)`
      : `${whoWithGender(rec)} (the new person is a ${rec.gender} even if the original is not)`;
  return (
    `Replace the person in this photo with a completely different person who looks nothing like ` +
    `the original: ${gender} with ` +
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

/**
 * No source photo: the note describes the shot and the recipe describes the
 * person. Without a note a generic at-home testimonial frame is made.
 */
export function ugcTextPrompt(note: string, rec: SwapRecipe): string {
  const scene =
    note.trim() ||
    "at home in a tidy, lived-in room with natural daylight, sitting close to the camera and talking to it casually as in a selfie-style testimonial video";
  const who = rec.gender === "keep" ? rec.who : whoWithGender(rec);
  return (
    `A single vertical 9:16 frame from a candid UGC phone video: ${who} ${ageOf(rec)} with ` +
    `${rec.skin}, ${rec.hairColor} hair styled as ${rec.hairCut} and ${rec.eyes} eyes. ` +
    `Attractive, fit and toned, healthy glowing skin, well groomed, photogenic, with a natural ` +
    `relaxed expression. Scene: ${scene}. ` +
    `Shot on a phone front camera at arm's length, slightly imperfect framing, soft natural light, ` +
    `natural skin texture, photoreal, no retouching look. ` +
    `No text, captions, subtitles, stickers, emojis, watermarks, logos, icons, buttons or app ` +
    `interface anywhere in the frame: a clean photograph only.`
  );
}
