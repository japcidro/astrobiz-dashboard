import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { imageBlock } from "@/lib/remake/vision";
import { BEAT_KINDS } from "./engines";
import type { BeatKind, RefRole } from "./types";

/**
 * Claude plans a head-tap hook: one beat per move asked for, each with its
 * part of the spoken line, the starting image and the hand movement, looking
 * at the reference images so the scenes describe the right people and room.
 */

const MODEL = "claude-opus-5-5";

export interface PlannedBeat {
  line: string;
  scene: string;
  motion: string;
}

export interface Plan {
  title: string;
  voice: string;
  beats: PlannedBeat[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "voice", "beats"],
  properties: {
    title: { type: "string", description: "3 to 6 words naming this take, in English" },
    voice: { type: "string", description: "The expert's voice for a video model that speaks the line: gender, age range, accent, tone" },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "scene", "motion"],
        properties: {
          line: { type: "string", description: "The exact words the expert says in this beat" },
          scene: { type: "string", description: "The starting image, in English" },
          motion: { type: "string", description: "The hand movement on the head and what the expert does, in English" },
        },
      },
    },
  },
} as const;

const VARIANT_ANGLE = [
  "Stay close to the marketer's direction.",
  "Change the framing: closer on the hands and the scalp, or a different camera angle.",
  "Change the room or the client's look while keeping the people in the references recognizable.",
  "Make it more urgent: tighter on the thinning, a more dramatic delivery.",
];

const SYSTEM = `You plan short vertical "head-tap" hook videos for a Philippine hair-care brand (hair loss, thinning hair). A hook is 3 to 8 seconds: an expert (stylist, trichologist or doctor) talks to the camera while touching a client's head: tapping and patting a thin crown, parting the hair to show the scalp, lifting thin strands. The hand on the head is what stops the scroll, so every beat shows it.

You get the marketer's direction, the head-tap moves wanted (one beat each, in that order), the spoken line or none, and reference images with their roles.

Rules:
- Return exactly one beat per move, in the given order.
- line: if the marketer gave a line, split it across the beats in order using the words exactly: do not add, drop, translate or fix words; the beat lines joined with spaces must equal the line. If there is no line, write a short hook of 6 to 12 words in all, in the direction's language (Taglish if the direction mixes English and Tagalog, otherwise English): the expert speaking to the viewer, a callout or curiosity hook about thinning hair, no medical claims, no promise of a cure, no brand names. Each beat's part is 3 to 6 words, about 2 seconds of speech, like the fast cuts of the reference hooks.
- scene: what the starting image shows at the start of the move: who (the expert and the client as they look in the reference images; with no reference for someone, a believable Filipino person who fits the direction), where (the setting reference, else a bright salon or clinic that fits the direction), framing (vertical phone video, medium close-up), and where the expert's hand is. When a reference shows a person, refer to them as "the expert from the reference" or "the client from the reference" instead of describing the face. English. No text on screen, no brand names, no logos.
- motion: one or two sentences: the exact hand movement on the head over the next few seconds (taps, pats, parting, lifting), the expert looking into the camera while talking, the camera mostly still and handheld. Simple and physical so an image-to-video model can do it.
- voice: one line describing how the expert sounds: gender, age range, accent (a natural Filipino accent unless the direction says otherwise), tone.
- Keep it tasteful: no nudity, no blood, no medical procedures.`;

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

const norm = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** The marketer's line in n even parts, for when Claude's split does not add back up to it. */
function splitEvenly(line: string, n: number): string[] {
  const w = norm(line);
  return Array.from({ length: n }, (_, i) => w.slice(Math.round((i * w.length) / n), Math.round(((i + 1) * w.length) / n)).join(" "));
}

export async function planHook(
  db: SupabaseClient,
  input: { direction: string; line: string; kinds: BeatKind[]; refs: Array<{ role: RefRole; url: string | null }>; variant: number }
): Promise<Plan | { error: string }> {
  const key = await apiKey(db);
  if (!key) return { error: "No Anthropic API key in Settings" };
  const client = new Anthropic({ apiKey: key });

  const moves = input.kinds.map((k, i) => {
    const kind = BEAT_KINDS.find((b) => b.id === k)!;
    return `${i + 1}. ${kind.name}. Typical start: ${kind.scene} Typical movement: ${kind.motion}`;
  });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        VARIANT_ANGLE[(input.variant - 1) % VARIANT_ANGLE.length],
        `Direction: ${input.direction.trim() || "none; make a believable salon scene"}`,
        `Head-tap moves (${input.kinds.length} beats, in this order):\n${moves.join("\n")}`,
        input.line.trim() ? `Spoken line (split it, word for word): ${input.line.trim()}` : "Spoken line: none; write one.",
        input.refs.length ? `${input.refs.length} reference images follow.` : "No reference images.",
      ].join("\n\n"),
    },
  ];
  for (const [i, ref] of input.refs.entries()) {
    const img = ref.url ? await imageBlock(ref.url) : null;
    if (!img) continue;
    content.push({ type: "text", text: `Reference image ${i + 1} (${ref.role}):` }, img as unknown as Anthropic.Beta.BetaImageBlockParam);
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined to plan this hook" };
    if (response.stop_reason === "max_tokens") return { error: "The plan came back cut off; try again" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const raw = JSON.parse(text) as Plan;
    const beats = raw.beats.slice(0, input.kinds.length).map((b) => ({ line: b.line.trim(), scene: b.scene.trim(), motion: b.motion.trim() }));
    if (beats.length < input.kinds.length || beats.some((b) => !b.scene || !b.motion)) return { error: `Claude planned ${beats.length} of ${input.kinds.length} beats; plan again` };
    // The marketer's own words are kept exactly; when Claude's split does not add back up, split them evenly instead.
    if (input.line.trim() && norm(beats.map((b) => b.line).join(" ")).join(" ") !== norm(input.line).join(" ")) {
      splitEvenly(input.line, beats.length).forEach((part, i) => (beats[i].line = part));
    }
    return { title: raw.title.trim().slice(0, 80) || "Head-tap hook", voice: raw.voice.trim().slice(0, 300), beats };
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Claude's plan was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Planning failed" };
  }
}
