import type { SupabaseClient } from "@supabase/supabase-js";
import type { Skill } from "./engines";

/**
 * Claude writes the video prompt for a hook. It sees the UGC image, so the
 * character and setting in the prompt match what the engine will animate.
 *
 * - motion skill: a short instruction to keep the image's person and scene
 *   and copy the reference clip's camera and action.
 * - arcads skill: a structured shot prompt in the claude-arcads style
 *   (setting, character, camera, beats, tone, movement, closing line).
 */

const MODEL = "claude-sonnet-5";

export interface PromptInput {
  skill: Skill;
  brief: string;
  seconds: number;
  /** Signed URL of the UGC image; fetched and sent to Claude as an image. */
  imageUrl: string | null;
  referenceName: string | null;
}

const SILENT_RULES = `Rules for every prompt:
- The clip is silent: say "No speech, no lip movement, no on-screen text, no captions, no subtitles."
- Vertical 9:16, phone-camera look, natural grain. Never use the words cinematic, professional, stunning, 8k, studio, perfect.
- Keep the person, clothing, background, furniture, props, phone and lighting exactly as in the image. Do not invent a different room or outfit.
- Describe motion with plain verbs (reaches, taps, closes her eyes, turns, sits up). No camera jargon beyond handheld, static, slow push-in, drift, pan.`;

function systemFor(skill: Skill): string {
  if (skill === "motion") {
    return `You write one short prompt (40-80 words) for a motion-transfer video model. The model
receives an image (the person and scene) and a reference video (the motion). Your prompt
tells it: keep the image's person, clothing, room and framing exactly; copy the reference
video's camera movement, action and timing; nothing else changes.
${SILENT_RULES}
Answer with JSON only: {"prompt": string}`;
  }
  return `You write a shot prompt (120-220 words) for an image-to-video model in this exact order:
1. Duration and aspect ratio, setting, lighting (as seen in the image).
2. The character as seen in the image: age range, hair, skin, clothing, accessories. Describe, never rename.
3. Camera: angle, distance, handheld or static, as the image implies.
4. Beat-by-beat action with timestamps covering the whole duration (e.g. "0-2s: ...").
5. Tone in one line.
6. Camera movement, grain, style in one line.
7. One closing emotional line starting with "The feeling of".
${SILENT_RULES}
Answer with JSON only: {"prompt": string}`;
}

function userFor(input: PromptInput): string {
  return [
    `Clip length: ${input.seconds} seconds, 9:16.`,
    input.brief.trim() ? `What should happen / what to keep (owner's brief): ${input.brief.trim()}` : "No brief given: keep the action natural for the scene (reach for the phone, tap it, settle).",
    input.referenceName ? `Reference clip: ${input.referenceName} (its motion will be copied by the model).` : "",
    input.imageUrl ? "The image attached is the exact frame the video starts from." : "No image was attached; describe a generic candid scene.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function imageBlock(url: string | null): Promise<Record<string, unknown> | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 4.5 * 1024 * 1024) return null;
    return { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

function extractPrompt(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1)) as { prompt?: unknown };
      if (typeof obj.prompt === "string" && obj.prompt.trim()) return obj.prompt.trim();
    } catch {
      // fall through
    }
  }
  return cleaned.length > 20 ? cleaned : null;
}

export async function writeVideoPrompt(
  db: SupabaseClient,
  input: PromptInput
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const { data: keyRow } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .maybeSingle();
  const apiKey = keyRow?.value as string | undefined;
  if (!apiKey) return { ok: false, error: "No Anthropic API key in Settings → AI." };

  const image = await imageBlock(input.imageUrl);
  const content: Array<Record<string, unknown>> = [];
  if (image) content.push(image);
  content.push({ type: "text", text: userFor(input) });

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: systemFor(input.skill),
        messages: [{ role: "user", content }],
      }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Claude request failed" };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Claude ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  const prompt = extractPrompt(text);
  if (!prompt) return { ok: false, error: "Claude's answer was not usable." };
  return { ok: true, prompt };
}
