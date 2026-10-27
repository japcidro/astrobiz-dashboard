// Bulk Create: ad copy suggested from one uploaded image.
//
// Claude looks at the creative and writes primary text, a headline and a
// description to the person and moment in that picture, using what the
// store already knows about its product (Brand Kit profile, default copy,
// saved presets, recent winner copy). One call per image; the caller fills
// only empty fields in the row with the result.
//
// Same SDK shape as the Script Generator and Hook Generator planners.
// Sonnet, as the approved mockup states: about ₱1 per image.

import Anthropic from "@anthropic-ai/sdk";
import type { SuggestCopyLanguage } from "@/lib/marketing/store-defaults";

export const SUGGEST_COPY_MODEL = "claude-sonnet-5-5";

// Facebook's recommended lengths; the prompt asks for them and the result
// is clipped as a last resort.
export const HEADLINE_MAX = 40;
export const DESCRIPTION_MAX = 30;
export const PRIMARY_TEXT_MAX = 300;

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
  // Copy of recent winner ads: tone and structure to learn from.
  winners: Array<{ primary_text: string; headline: string }>;
  language: SuggestCopyLanguage;
  // Regenerate / "More English" / "Shorter": what to do differently.
  instruction: string | null;
  // The copy being replaced, so a regeneration does not repeat it.
  previous: { primary_text: string; headline: string; description: string } | null;
}

const LANGUAGE_RULES: Record<SuggestCopyLanguage, string> = {
  taglish:
    "Write in Taglish that is roughly 75% English and 25% Filipino: mostly English with a natural sprinkle of Filipino words and phrases the way Filipinos actually post on Facebook. Never translate word for word.",
  english: "Write in plain, warm Philippine English. No Filipino words.",
  tagalog:
    "Write mostly in conversational Filipino (Tagalog), with English only for product names and words Filipinos normally say in English (COD, order, free shipping).",
};

function buildSystemPrompt(ctx: SuggestContext): string {
  const parts: string[] = [];
  parts.push(
    `You write Facebook ad copy for a Philippine e-commerce store${ctx.storeName ? ` called ${ctx.storeName}` : ""}. You are given ONE ad image. First read it carefully: who is shown (age range, gender, what they are doing), the setting and mood, every word printed on the image, whether the product is visible, and any promo. Then write copy for THAT image: speak to the person and the moment in the picture, so an ad showing a grandmother rubbing her knee reads differently from one showing a man jogging. When the image carries a headline or promo text, the headline must echo it, never contradict it.`
  );
  parts.push(LANGUAGE_RULES[ctx.language]);
  parts.push(
    `Rules:
- Use only product facts given below. Never invent prices, discounts, ingredients, numbers, awards or results. If no product facts are given, stay with the feeling and the offer mechanics you are told about, and never name a product you cannot see.
- No medical, cure, or guaranteed-result claims; no before/after; no personal attributes ("you are overweight", "your diabetes"). Speak to the situation, not the person's condition.
- Refer to the person shown in a way that matches the image. If nobody is shown, do not say he/she or address a specific person.
- primary_text: 2 to 4 short sentences, at most ${PRIMARY_TEXT_MAX} characters, a hook first, the offer or call to action last. One emoji at most.
- headline: at most ${HEADLINE_MAX} characters.
- description: at most ${DESCRIPTION_MAX} characters, usually the offer mechanic (COD, free shipping) or a short promise.
- headline_alternatives: 3 different headlines, each at most ${HEADLINE_MAX} characters, with different angles (question, benefit, promo).
- Do not write "it's not X, it's Y" reveals, and do not start with "Introducing".`
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
  if (ctx.winners.length > 0) {
    parts.push(
      `Copy of this store's recent winning ads. Learn the tone, rhythm and structure; do not repeat them:\n${ctx.winners
        .slice(0, 6)
        .map((w, i) => `Winner ${i + 1}\nPrimary text: ${w.primary_text.replace(/\s+/g, " ").slice(0, 600)}\nHeadline: ${w.headline}`)
        .join("\n\n")}`
    );
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
  if (ctx.instruction?.trim()) lines.push(`Extra instruction from the marketer: ${ctx.instruction.trim().slice(0, 400)}`);
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

/** One image in, one suggestion out. The error is in the API's words when the call fails. */
export async function suggestAdCopy(
  apiKey: string,
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" },
  ctx: SuggestContext
): Promise<SuggestResult> {
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model: SUGGEST_COPY_MODEL,
      max_tokens: 2000,
      // A safety decline on an ordinary ad photo is rare; when it happens
      // the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Reading one image and writing three short fields is routine work;
      // low effort keeps it at a few seconds.
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
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
    const primary = clip(parsed.primary_text, PRIMARY_TEXT_MAX);
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
