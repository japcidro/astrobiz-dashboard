// Generates benign, engagement-focused ad copy for a "safe image" used by
// the Fix Rejections flow. Claude (vision) reads the image and writes a
// headline, primary text, description, and CTA whose only goal is to draw
// harmless engagement (likes/comments/shares) so a re-reviewed ad clears
// its rejection and seasons the ad account — NOT to sell anything.
//
// Raw HTTP to match the existing ad-rejection-analysis route (this project
// doesn't use the Anthropic SDK). Sonnet 4.6 is used for cost + because it
// matches the sibling marketing-AI feature; bump to claude-opus-4-8 if you
// want maximum quality.

export const FIX_REJECTION_COPY_MODEL = "claude-sonnet-4-6";

export const FIX_REJECTION_CTAS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "GET_OFFER",
  "ORDER_NOW",
  "CONTACT_US",
  "BOOK_NOW",
] as const;

export type FixRejectionCta = (typeof FIX_REJECTION_CTAS)[number];

export interface EngagementCopy {
  headline: string;
  primary_text: string;
  description: string;
  cta: FixRejectionCta;
}

const SYSTEM_PROMPT = `You write SHORT, harmless, friendly Facebook ad copy whose ONLY purpose is to attract benign engagement (likes, comments, shares) on a safe image — usually a cute animal like a cat. This copy replaces a DISAPPROVED ad's creative so Facebook re-reviews and approves it. It must NOT sell, make claims, mention prices/discounts, health/medical/weight benefits, "before/after", testimonials, or anything policy-sensitive. Keep it wholesome and universally approvable. Write in Taglish that is roughly 75% English and 25% Filipino — mostly English with a light, natural sprinkle of Filipino words/phrases (not the other way around). Look at the image and reference what's actually in it.

Return:
- headline: <= 40 chars, friendly hook (emoji ok)
- primary_text: 1-2 short friendly sentences inviting a like/comment/tag (emoji ok)
- description: <= 30 chars, light tagline
- cta: pick the most harmless fit (LEARN_MORE is usually safest)`;

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

// Returns null on any failure — callers fall back to a generic default so a
// missing/failed AI call never blocks the safe-image upload itself.
export async function generateEngagementCopy(
  imageBase64: string,
  mediaType: string,
  apiKey: string
): Promise<EngagementCopy | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: FIX_REJECTION_COPY_MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                headline: { type: "string" },
                primary_text: { type: "string" },
                description: { type: "string" },
                cta: { type: "string", enum: [...FIX_REJECTION_CTAS] },
              },
              required: ["headline", "primary_text", "description", "cta"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: "Write engagement copy for this safe image per your instructions.",
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as ClaudeResponse;
    const text = json.content?.find((b) => b.type === "text" && b.text)?.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as Partial<EngagementCopy>;
    const cta = FIX_REJECTION_CTAS.includes(parsed.cta as FixRejectionCta)
      ? (parsed.cta as FixRejectionCta)
      : "LEARN_MORE";
    if (!parsed.headline?.trim()) return null;
    return {
      headline: parsed.headline.trim(),
      primary_text: (parsed.primary_text ?? "").trim(),
      description: (parsed.description ?? "").trim(),
      cta,
    };
  } catch {
    return null;
  }
}
