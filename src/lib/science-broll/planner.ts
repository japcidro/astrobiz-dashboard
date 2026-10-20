import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_BEATS, MAX_BEAT_SECONDS, MIN_BEAT_SECONDS, MOVES, SCALES, type Look, type MoveId, type ScaleId } from "./engines";

/**
 * Claude reads the text and plans the b-roll: one beat per idea, each with a
 * named move, the subject to draw, the starting image and what moves.
 */

const MODEL = "claude-opus-5-5";
const MOVE_IDS = MOVES.map((m) => m.id);
const SCALE_IDS = SCALES.map((s) => s.id);

export interface PlannedBeat {
  line: string;
  seconds: number;
  move: MoveId;
  scale: ScaleId;
  scene: string;
  motion: string;
}

export interface Plan {
  title: string;
  /** The subject at rest, for the style anchor: no arrows, highlights or particles. */
  anchor_scene: string;
  beats: PlannedBeat[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "anchor_scene", "beats"],
  properties: {
    title: { type: "string", description: "3 to 6 words naming this set, in English" },
    anchor_scene: { type: "string", description: "The set's main subject at rest, for the style anchor: the tissue, the cut, the subject and the structures around it, nothing happening, no highlight, no arrows, no particles" },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "seconds", "move", "scale", "scene", "motion"],
        properties: {
          line: { type: "string", description: "The words of the text this beat illustrates, exactly as given" },
          seconds: { type: "number", description: "How long the clip holds, 3 to 6" },
          move: { type: "string", enum: MOVE_IDS },
          scale: { type: "string", enum: SCALE_IDS, description: "Where the camera is for this beat" },
          scene: { type: "string", description: "The starting image: the subject and its state, in English, in the style bible's terms" },
          motion: { type: "string", description: "What moves over the clip and what the camera does, one or two sentences" },
        },
      },
    },
  },
} as const;

const VARIANT_ANGLE = [
  "Picture each idea the most direct way, moving through the scales as the reference films do.",
  "Change the camera: a different scale for the same ideas (closer in, or one level out), still one idea per beat.",
  "Lean on contrast: more split comparisons and problem-then-calm pairs, the same facts.",
];

const SYSTEM = `You plan short vertical science b-roll for Philippine health-supplement ads: the textbook-style cross-section illustrations an ad cuts to while the voice explains what happens inside the body. The marketer gives you text: script lines, or a plain description of what to show.

You split the text into beats and design one shot per beat. A shot has a scale (where the camera is) and a move (what happens).

Scales:
${SCALES.map((s) => `- "${s.id}" (${s.name}): ${s.what}`).join("\n")}

Moves:
${MOVES.map((m) => `- "${m.id}" (${m.name}): ${m.what}`).join("\n")}

The reference films move through the body as the voice goes on: a real forearm with the patch (surface) → the skin cut open under it (section) → the molecules passing between the cells (cellular) → inside a capillary with the red blood cells (vessel) → the whole body lit (body) → back to the arm (surface). Plan a set the same way: change the scale as the text moves, never hold one framing for the whole set, and never put two beats at the same scale and framing in a row unless the text stays on one thing (a problem beat and its calm beat on the same shot).

Rules:
- One idea per beat, 3 to 6 seconds each, at most ${MAX_BEATS} beats. Use the text's own words for "line", in order, split across the beats; do not add, drop or translate words.
- Pick the subject from the words: scalp and follicle for hair; stomach, gut wall, liver for pills and digestion; skin layers under a patch for transdermal; a capillary or vein for the bloodstream; a cell for hormones and energy; fat cells for weight; the whole body when the claim is systemic. When the text names no body part, choose the organ where the claim happens and vary the scale around it. Never assume hair.
- Pick the scale from the sentence: a product on the body or a body part seen from outside → surface; "under the skin", "in the gut", a layer → section; cells, receptors, a root, molecules passing → cellular; "into the bloodstream", blood, oxygen → vessel; "throughout the body", the system → body.
- Pick the move from what the line does: explaining the anatomy → cross_section; something happening → process; the problem → problem; the fix settling → calm; an ingredient reaching its target → flow; a comparison → split; recovery → comeback.
- Keep consecutive beats on the same subject at the same framing when the text stays on one thing, so a problem beat and its calm beat read as one scene changing. Change the subject only when the text does.
- "scene" describes only the picture at that scale: what the camera sees, the subject and its state, what is highlighted and in which colour, where any particles, drops, a patch or a capsule sit, how deep the focus is. English. No text on screen, no labels, no brand names, no faces, no gore.
- "motion" is one or two sentences in the move's grammar: molecules travelling through, red blood cells tumbling past, a glow growing or fading, a strand thinning or thickening, a release spreading, the camera gliding in or along the path, or a hold. Simple and physical so an image-to-video model can do it.
- "anchor_scene" is the set's hero shot at rest, drawn once as the style anchor every still is matched to for render, palette and lighting (not for framing): usually the section or cellular scale of the main subject, the one subject and only the structures that belong around it, each complete and attached (a vessel runs through the deeper layer and branches toward the subject, never a loose tube). Nothing happening: no arrows, particles, drops, glows or highlights, no product.
- The marketer's notes win over these rules.`;

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

function clean(plan: Plan): Plan {
  const beats = plan.beats
    .filter((b) => b.scene?.trim())
    .slice(0, MAX_BEATS)
    .map((b) => ({
      line: String(b.line ?? "").trim().slice(0, 400),
      seconds: Math.round(Math.min(MAX_BEAT_SECONDS, Math.max(MIN_BEAT_SECONDS, Number(b.seconds) || 4)) * 10) / 10,
      move: (MOVE_IDS as string[]).includes(b.move) ? (b.move as MoveId) : "cross_section",
      scale: (SCALE_IDS as string[]).includes(b.scale) ? (b.scale as ScaleId) : "section",
      scene: b.scene.trim().slice(0, 1200),
      motion: String(b.motion ?? "").trim().slice(0, 600),
    }));
  return { title: String(plan.title ?? "").trim().slice(0, 80) || "Science b-roll", anchor_scene: String(plan.anchor_scene ?? "").trim().slice(0, 1200) || beats[0]?.scene || "", beats };
}

export async function planBroll(db: SupabaseClient, input: { text: string; direction: string; variant: number; look: Look }): Promise<Plan | { error: string }> {
  const key = await apiKey(db);
  if (!key) return { error: "No Anthropic API key in Settings" };
  const client = new Anthropic({ apiKey: key });
  const notes = input.direction.trim() ? `Marketer's notes: ${input.direction.trim()}` : "Marketer's notes: none.";
  const lookNote = input.look.id === "cinematic" ? "Look: cinematic photoreal 3D medical animation; surface beats are photoreal shots of real skin, a real patch or capsule, a real hand." : "Look: textbook plate; every beat is a drawn cross-section or diagram on sky blue, surface beats are drawn too.";
  const user = `${VARIANT_ANGLE[(input.variant - 1) % VARIANT_ANGLE.length]}\n${lookNote}\n${notes}\n\nText:\n${input.text.trim()}`;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 12000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined to plan this text" };
    if (response.stop_reason === "max_tokens") return { error: "The plan came back cut off; try a shorter text" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const plan = clean(JSON.parse(text) as Plan);
    if (plan.beats.length === 0) return { error: "Claude returned no beats" };
    return plan;
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Claude's plan was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Planning failed" };
  }
}
