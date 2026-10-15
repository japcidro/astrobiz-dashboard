import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_BEATS } from "./engines";
import type { BeatStyle, CartoonStyle } from "./types";

/**
 * Claude reads the script and plans the hook the way the reference cartoon
 * ads are cut: a new image every 2-3 seconds, each one a literal or
 * exaggerated picture of the words being said, one recurring main character.
 */

const MODEL = "claude-opus-5-5";
const BEAT_STYLES: BeatStyle[] = ["pixar3d", "flat2d", "medical"];

export interface PlannedBeat {
  line: string;
  seconds: number;
  style: BeatStyle;
  uses_character: boolean;
  scene: string;
  motion: string;
}

export interface Plan {
  title: string;
  character: { needed: boolean; style: BeatStyle; description: string };
  beats: PlannedBeat[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "character", "beats"],
  properties: {
    title: { type: "string", description: "3 to 6 words naming this take, in English" },
    character: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "style", "description"],
      properties: {
        needed: { type: "boolean" },
        style: { type: "string", enum: BEAT_STYLES },
        description: { type: "string", description: "What the main character looks like, concrete enough to draw the same person every time" },
      },
    },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "seconds", "style", "uses_character", "scene", "motion"],
        properties: {
          line: { type: "string", description: "The exact script words spoken over this beat" },
          seconds: { type: "number", description: "How long the line takes to say" },
          style: { type: "string", enum: BEAT_STYLES },
          uses_character: { type: "boolean" },
          scene: { type: "string", description: "The starting image, in English" },
          motion: { type: "string", description: "What moves during the clip and what the camera does, in English" },
        },
      },
    },
  },
} as const;

const STYLE_RULE: Record<CartoonStyle, string> = {
  pixar3d: 'Every beat uses style "pixar3d" (3D animated movie look).',
  flat2d: 'Every beat uses style "flat2d" (flat 2D webcomic look, simple round-head people).',
  medical: 'Every beat uses style "medical" (glowing see-through anatomy, cells, hormones, lab glassware).',
  mixed:
    'Mix styles like the reference ads: "pixar3d" or "flat2d" for people and everyday moments, "medical" when the line explains what happens inside the body (hormones, organs, cells, test results). Keep one main character style; the character only appears in "pixar3d" or "flat2d" beats of that same style.',
};

const VARIANT_ANGLE = [
  "Picture each line literally and clearly.",
  "Go bigger and funnier: exaggerated reactions, visual gags, dramatic moments.",
  "Lean into explaining: more inside-the-body and before/after visuals, still with the character for the emotional beats.",
];

const SYSTEM = `You plan short vertical cartoon video ads for a Philippine health-supplement brand. The voiceover is in Taglish. The reference ads cut to a new image every 2-3 seconds; each image is a vivid, literal or exaggerated picture of the words being said at that moment (a tito looking down at his big belly while the voice says "hindi ito ordinaryong taba", a red angry face at the dinner table at 6 PM for "mainit ang ulo", a glowing transparent body with orange stress hormones for "cortisol").

You split the script into beats and design one starting image and one motion per beat.

Rules:
- Use the script's words exactly, in order, split across the beats. Do not add, drop, translate or fix words; the beat lines joined with spaces must equal the script.
- A beat is 1.5 to 4 seconds of speech. Taglish is spoken at about 2.6 words per second; set "seconds" from the word count (round to one decimal, minimum 1.5). Split long sentences; join very short fragments.
- At most ${MAX_BEATS} beats.
- One main character carries the story (from the marketer's notes if given, otherwise a Filipino man or woman who fits the script). Describe them once in "character.description" with age, build, face, hair and outfit so every image can match. Set "uses_character" on each beat where they appear. If no beat needs a recurring person, set character.needed to false.
- "scene" describes only what the image shows: who, doing what, where, expression, framing. English. No text, captions, labels, numbers on screen, brand names or logos. No real or famous people. Do not show the product or any bottle unless the marketer's notes ask for it.
- "motion" is one sentence: what moves in the next few seconds and what the camera does (slow push-in, static, slight pan). Keep it simple and physical so an image-to-video model can do it.
- Keep everything tasteful: no nudity, gore or medical procedures.`;

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

function clean(plan: Plan, style: CartoonStyle): Plan {
  const fixStyle = (s: string): BeatStyle => (style !== "mixed" ? style : BEAT_STYLES.includes(s as BeatStyle) ? (s as BeatStyle) : "pixar3d");
  const beats = plan.beats
    .filter((b) => b.line.trim() && b.scene.trim())
    .slice(0, MAX_BEATS)
    .map((b) => ({
      line: b.line.trim(),
      seconds: Math.round(Math.min(6, Math.max(1.5, Number(b.seconds) || 2.5)) * 10) / 10,
      style: fixStyle(b.style),
      uses_character: !!b.uses_character && plan.character.needed,
      scene: b.scene.trim(),
      motion: b.motion.trim() || "Subtle natural movement, slow camera push-in.",
    }));
  const needed = plan.character.needed && beats.some((b) => b.uses_character);
  return {
    title: plan.title.trim().slice(0, 80) || "Cartoon hook",
    character: { needed, style: fixStyle(plan.character.style === "medical" ? "pixar3d" : plan.character.style), description: plan.character.description.trim() },
    beats,
  };
}

export async function planHook(
  db: SupabaseClient,
  input: { script: string; style: CartoonStyle; direction: string; variant: number }
): Promise<Plan | { error: string }> {
  const key = await apiKey(db);
  if (!key) return { error: "No Anthropic API key in Settings" };
  const client = new Anthropic({ apiKey: key });
  const notes = input.direction.trim() ? `Marketer's notes: ${input.direction.trim()}` : "Marketer's notes: none.";
  const user = `${STYLE_RULE[input.style]}\n${VARIANT_ANGLE[(input.variant - 1) % VARIANT_ANGLE.length]}\n${notes}\n\nScript:\n${input.script.trim()}`;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined to plan this script" };
    if (response.stop_reason === "max_tokens") return { error: "The plan came back cut off; try a shorter script" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const plan = clean(JSON.parse(text) as Plan, input.style);
    if (plan.beats.length === 0) return { error: "Claude returned no beats" };
    return plan;
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Claude's plan was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Planning failed" };
  }
}
