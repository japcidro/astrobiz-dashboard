// Bulk Create: ad copy suggested from one uploaded image.
//
// Claude looks at the creative and writes primary text, a headline and a
// description to the person and moment in that picture, using what the
// store already knows about its product (Brand Kit profile, default copy,
// saved presets) and the copy of its best-selling ads, which sets the bar:
// their length, structure and voice. One call per image; the caller fills
// only empty fields in the row with the result.
//
// Same SDK shape as the Script Generator and Hook Generator planners.
// Sonnet: about ₱2 per image with the best sellers' copy in the prompt.

import Anthropic from "@anthropic-ai/sdk";
import type { SuggestCopyLanguage } from "@/lib/marketing/store-defaults";
import type { WinningCopy } from "@/lib/marketing/winning-copy";

export const SUGGEST_COPY_MODEL = "claude-sonnet-5-5";

// Room for what sells: the best-selling primary texts run 1,000 to 2,700
// characters and some winning headlines and descriptions 80. The prompt
// sets the length from the store's best sellers; these clip as a last resort.
export const HEADLINE_MAX = 90;
export const DESCRIPTION_MAX = 90;
export const PRIMARY_TEXT_MAX = 3000;
/** Primary text to write when the store has no best sellers to measure against. */
const DEFAULT_PRIMARY_LENGTH = "800 to 1,500 characters";

/** What Claude saw in the image, shown on the row so the copy makes sense. */
export interface ImageRead {
  person: string;
  setting: string;
  text_on_image: string;
  product_visible: boolean;
  promo: string;
  angle: string;
}

export interface CopySuggestion {
  read: ImageRead;
  primary_text: string;
  headline: string;
  description: string;
  headline_alternatives: string[];
}

export interface SuggestContext {
  storeName: string | null;
  // Brand Kit profile: product, price, audience, angle, compliance.
  brandProfile: string | null;
  // Brand Kit rules (what never to say or show).
  brandRules: string | null;
  defaultCopy: { primary_text: string; headline: string; description: string } | null;
  presets: Array<{ kind: string; content: string }>;
  // The store's best-selling primary texts, headlines and descriptions, with what each sold.
  winning: WinningCopy | null;
  language: SuggestCopyLanguage;
  // Regenerate / "More English" / "Shorter": what to do differently.
  instruction: string | null;
  // The copy being replaced, so a regeneration does not repeat it.
  previous: { primary_text: string; headline: string; description: string } | null;
}

const LANGUAGE_RULES: Record<SuggestCopyLanguage, string> = {
  taglish:
    "Write in Taglish, roughly 75% English: English with Filipino mixed into the same paragraphs and often the same sentence, the way Filipinos actually post on Facebook. When the store's best-selling copy is given below, match its mix. Never translate word for word.",
  english: "Write in plain, warm Philippine English. No Filipino words.",
  tagalog:
    "Write mostly in conversational Filipino (Tagalog), with English only for product names and words Filipinos normally say in English (COD, order, free shipping).",
};

function buildSystemPrompt(ctx: SuggestContext): string {
  const parts: string[] = [];
  const top = ctx.winning?.primary_texts[0];
  const primaryLength = top
    ? `about ${Math.round(top.text.length / 100) * 100} characters, as long as the store's best-selling primary text, and built the way the best-selling primary texts below are built (how they open, the order of their beats, how they bring in the product and close). Where they leave it open:`
    : `${DEFAULT_PRIMARY_LENGTH}:`;
  parts.push(
    `You write Facebook ad copy for a Philippine e-commerce store${ctx.storeName ? ` called ${ctx.storeName}` : ""}. You are given ONE ad image. First read it carefully: who is shown (age range, gender, what they are doing), the setting and mood, every word printed on the image, whether the product is visible, and any promo. Then write copy for THAT image: the story belongs to the person and the moment in the picture, so an ad showing a grandmother rubbing her knee reads differently from one showing a man jogging. When the image carries a headline or promo text, the headline must echo it, never contradict it.`
  );
  parts.push(LANGUAGE_RULES[ctx.language]);
  parts.push(
    `Rules:
- Use only product facts given below. Never invent prices, discounts, ingredients, numbers, reviews, awards or results. If no product facts are given, stay with the feeling and the offer mechanics you are told about, and never name a product you cannot see.
- No medical, cure, or guaranteed-result claims, and never say the product changed a person's body, health or behaviour: say what an ingredient supports ("supports normal immune function"), not what the product did. No personal attributes aimed at the reader ("you are overweight", "your diabetes"); a customer telling their own story is fine.
- Refer to the person shown in a way that matches the image. If nobody is shown, the story is told by a customer from the store's audience, about their own life.
- primary_text: ${primaryLength} one real customer telling what happened, in the first person, in this order: a first line that is a concrete moment, confession or question in their own words (most people see only that line before "See more", so it carries the ad; never the product name); the struggle in specific, everyday detail (what they tried, what went wrong, small true-to-life particulars); the feeling they would not say out loud; how they found the product and the one thing that won them over; what it is and what is in it, from the product facts; an honest limit (what it did not fix) that makes it believable; the real payoff; then the specs, the offer and a plain call to action. Short lines, one thought each, a blank line between them. At most one emoji, at the end.
- headline: at most ${HEADLINE_MAX} characters, in the shape of the best-selling headlines when given: the product's promise in a few words, or the customer's situation as a question.
- description: at most ${DESCRIPTION_MAX} characters: what it is, who it is for, and the offer mechanic (COD, free shipping, money-back).
- headline_alternatives: 3 different headlines, each at most ${HEADLINE_MAX} characters, with different angles (promise, situation, offer).
- Do not start with "Introducing", and use at most one "it wasn't X, it was Y" turn in the whole text.`
  );
  if (ctx.brandProfile?.trim()) parts.push(`Product facts (Brand Kit profile):\n${ctx.brandProfile.trim().slice(0, 6000)}`);
  if (ctx.brandRules?.trim()) parts.push(`Brand rules:\n${ctx.brandRules.trim().slice(0, 3000)}`);
  if (ctx.defaultCopy && (ctx.defaultCopy.primary_text || ctx.defaultCopy.headline || ctx.defaultCopy.description)) {
    parts.push(
      `The store's default copy, for tone and offer mechanics (do not copy it, write to the image):\nPrimary text: ${ctx.defaultCopy.primary_text || "—"}\nHeadline: ${ctx.defaultCopy.headline || "—"}\nDescription: ${ctx.defaultCopy.description || "—"}`
    );
  }
  if (ctx.presets.length > 0) {
    parts.push(
      `Saved copy presets of this store, for voice and the phrases that are safe to use:\n${ctx.presets
        .slice(0, 12)
        .map((p) => `- [${p.kind}] ${p.content.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n")}`
    );
  }
  const w = ctx.winning;
  if (w && (w.primary_texts.length > 0 || w.headlines.length > 0)) {
    const sold = (x: { purchases: number; cpp: number }) => `${x.purchases} purchases at ₱${x.cpp} each`;
    const lines = [
      `This store's best-selling ad copy over the last ${w.days} days, ranked by purchases${w.store_cpp ? ` (the store averages ₱${w.store_cpp} per purchase; lower is better)` : ""}. This is the bar: write copy as strong as these, with their length, structure, voice and language mix, told for THIS image. Do not reuse their story or lines, except the offer and call-to-action lines, which you may reuse word for word. Learn only from entries that sell the product; skip any page-post bait unrelated to it (a cute-animal caption).`,
      ...w.primary_texts.map((p, i) => `Best-selling primary text ${i + 1}, ${sold(p)}:\n"""\n${p.text}\n"""`),
    ];
    if (w.headlines.length > 0) lines.push(`Best-selling headlines:\n${w.headlines.map((h) => `- "${h.text}" (${sold(h)})`).join("\n")}`);
    if (w.descriptions.length > 0) lines.push(`Best-selling descriptions:\n${w.descriptions.map((d) => `- "${d.text}" (${sold(d)})`).join("\n")}`);
    parts.push(lines.join("\n\n"));
  }
  return parts.join("\n\n");
}

function buildQuestion(ctx: SuggestContext): string {
  const lines = ["Read this ad image and write the copy per your instructions."];
  if (ctx.previous) {
    lines.push(
      `The copy below was already suggested for this image. Write something clearly different: a different hook and a different headline, not a rewording.\nPrevious primary text: ${ctx.previous.primary_text}\nPrevious headline: ${ctx.previous.headline}\nPrevious description: ${ctx.previous.description}`
    );
  }
  if (ctx.instruction?.trim()) lines.push(`Extra instruction from the marketer, which overrides the length and structure rules: ${ctx.instruction.trim().slice(0, 400)}`);
  return lines.join("\n\n");
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    read: {
      type: "object",
      properties: {
        person: { type: "string", description: "Who is shown and what they are doing, or 'Nobody' when no person is shown." },
        setting: { type: "string" },
        text_on_image: { type: "string", description: "Every word printed on the image, verbatim; empty when there is none." },
        product_visible: { type: "boolean" },
        promo: { type: "string", description: "The promo shown on the image, or empty." },
        angle: { type: "string", description: "The one angle the copy takes, in a few words." },
      },
      required: ["person", "setting", "text_on_image", "product_visible", "promo", "angle"],
      additionalProperties: false,
    },
    primary_text: { type: "string" },
    headline: { type: "string" },
    description: { type: "string" },
    headline_alternatives: { type: "array", items: { type: "string" } },
  },
  required: ["read", "primary_text", "headline", "description", "headline_alternatives"],
  additionalProperties: false,
} as const;

/** Shrinks an uploaded creative to what Claude needs (long side 1024, JPEG). */
export async function prepareImage(
  buf: Buffer,
  mimeType: string
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | null> {
  const okTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  type Ok = (typeof okTypes)[number];
  let type: Ok | null = (okTypes as readonly string[]).includes(mimeType) ? (mimeType as Ok) : null;
  let out = buf;
  if (type !== "image/gif") {
    try {
      const sharp = (await import("sharp")).default;
      out = await sharp(buf)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      type = "image/jpeg";
    } catch {
      // Keep the original if sharp cannot read it; Claude may still manage.
    }
  }
  if (!type || out.byteLength > 4.5 * 1024 * 1024) return null;
  return { base64: out.toString("base64"), mediaType: type };
}

export interface SuggestResult {
  suggestion: CopySuggestion | null;
  error: string | null;
}

function clip(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
  return t.length > max ? t.slice(0, max).trim() : t;
}

/** Like clip, but keeps the line breaks: long primary text is written as short lines with blank lines between. */
function clipLines(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  return t.length > max ? t.slice(0, max).trim() : t;
}

/** One image in, one suggestion out. The error is in the API's words when the call fails. */
export async function suggestAdCopy(
  apiKey: string,
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" },
  ctx: SuggestContext
): Promise<SuggestResult> {
  // A long story takes 15–30 seconds; the route allows 120, room for one retry.
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model: SUGGEST_COPY_MODEL,
      max_tokens: 5000,
      // A safety decline on an ordinary ad photo is rare; when it happens
      // the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // A long story written to the best sellers' bar: medium effort, about
      // fifteen seconds.
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: buildSystemPrompt(ctx),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            { type: "text", text: buildQuestion(ctx) },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { suggestion: null, error: "Claude declined to write copy for this image" };
    }
    if (response.stop_reason === "max_tokens") {
      return { suggestion: null, error: "Claude's answer came back cut off; try again" };
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (!text) return { suggestion: null, error: "Claude returned no copy" };
    let parsed: Partial<CopySuggestion>;
    try {
      parsed = JSON.parse(text) as Partial<CopySuggestion>;
    } catch {
      return { suggestion: null, error: "Claude returned copy in an unexpected shape" };
    }
    const headline = clip(parsed.headline, HEADLINE_MAX);
    const primary = clipLines(parsed.primary_text, PRIMARY_TEXT_MAX);
    if (!headline || !primary) return { suggestion: null, error: "Claude returned empty copy" };
    const read = parsed.read ?? ({} as Partial<ImageRead>);
    return {
      suggestion: {
        read: {
          person: clip(read.person, 200),
          setting: clip(read.setting, 200),
          text_on_image: clip(read.text_on_image, 300),
          product_visible: !!read.product_visible,
          promo: clip(read.promo, 120),
          angle: clip(read.angle, 120),
        },
        primary_text: primary,
        headline,
        description: clip(parsed.description, DESCRIPTION_MAX),
        headline_alternatives: (Array.isArray(parsed.headline_alternatives) ? parsed.headline_alternatives : [])
          .map((h) => clip(h, HEADLINE_MAX))
          .filter((h) => h && h !== headline)
          .slice(0, 3),
      },
      error: null,
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { suggestion: null, error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { suggestion: null, error: "Claude took too long" };
    if (e instanceof Anthropic.APIError) return { suggestion: null, error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { suggestion: null, error: e instanceof Error ? e.message : "Suggestion failed" };
  }
}
