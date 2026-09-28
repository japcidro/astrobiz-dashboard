import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claude turns the owner's one-line brief into the edit prompt the video
 * engine gets, plus three on-screen text options in SoulShot's voice.
 */

const MODEL = "claude-sonnet-5";

/** What Claude knows about the app. Kept short; it is a hook, not the app. */
const SOULSHOT_BRIEF = `SoulShot is a mobile app that delivers one personalized spoken audio clip of
about a minute ("a shot") every day: a prayer, a motivation, or a manifestation,
generated from what the app knows about the user. The user's only job is to
press play. Weekly subscription, Philippine audience, Taglish is natural.
Brand feel: golden hour, calm, warm, unhurried. Never guilt or shame.
Prayer never speaks as God. Manifestation never promises cures, money, or dates.
The ad format is a silent UGC-style clip: a real-looking person in a real
moment (in bed, commuting, in the car, at night) reaching for the phone,
earphones in, pressing play. Text on screen carries the hook; there is no
voice.`;

export interface PromptInput {
  lane: "prayer" | "motivation" | "manifestation";
  brief: string;
  creator: string;
  screenMode: "dark" | "app";
  referenceName: string | null;
  clipSeconds: number | null;
  hasFace: boolean;
}

export interface PromptOutput {
  edit_prompt: string;
  text_options: string[];
}

function buildSystem(): string {
  return `You write prompts for a video-editing AI (Kling / Seedance style) and short
on-screen hook lines for SoulShot ads. Answer with JSON only.

${SOULSHOT_BRIEF}

The edit prompt tells the engine how to remake a reference video. It must:
- Keep the exact framing, camera motion, pacing and timing of the reference.
- Replace the person with the requested new person (age, gender, look, hair,
  clothes described concretely and plainly). If a pinned face reference image
  is provided, say the new person must match the reference image.
- Remove every piece of on-screen text, caption, sticker, watermark and logo.
- Say what the phone screen shows: either "the phone screen stays dark/off" or
  "the phone screen shows a warm, minimal audio player with a large play button".
- Say there is no speech and no lip movement.
- Stay under 120 words, one paragraph, positive phrasing (say what to show, not
  what to avoid, except the removals above).

The three text options are hook lines to overlay on the clip. Each is one
line under 60 characters, in the app's voice, Taglish welcome, no hashtags,
no emoji, no quotation marks, no claims of results. Make them different from
each other: one POV/moment line, one "what I do every morning" line, one
curiosity line.

Return exactly: {"edit_prompt": string, "text_options": [string, string, string]}`;
}

function buildUser(input: PromptInput): string {
  const who =
    input.creator === "Let the model decide"
      ? "a young Filipino adult, your choice of gender and look"
      : input.creator;
  return [
    `Lane: ${input.lane}`,
    `Owner's brief (what to keep, what to change): ${input.brief || "(none given)"}`,
    `New person: ${who}${input.hasFace ? " — a pinned face reference image will be attached; match it." : ""}`,
    `Phone screen: ${input.screenMode === "app" ? "show the app's Play screen" : "dark / off"}`,
    input.referenceName ? `Reference file: ${input.referenceName}` : "",
    input.clipSeconds ? `Clip length after trim: ${input.clipSeconds} seconds` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJson(text: string): PromptOutput | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<PromptOutput>;
    const prompt = typeof obj.edit_prompt === "string" ? obj.edit_prompt.trim() : "";
    const options = Array.isArray(obj.text_options)
      ? obj.text_options.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 3)
      : [];
    if (!prompt) return null;
    return { edit_prompt: prompt, text_options: options };
  } catch {
    return null;
  }
}

export async function writeHookPrompts(
  db: SupabaseClient,
  input: PromptInput
): Promise<{ ok: true; result: PromptOutput } | { ok: false; error: string }> {
  const { data: keyRow } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .maybeSingle();
  const apiKey = keyRow?.value as string | undefined;
  if (!apiKey) return { ok: false, error: "No Anthropic API key in Settings → AI." };

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
        max_tokens: 800,
        system: buildSystem(),
        messages: [{ role: "user", content: buildUser(input) }],
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
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  const parsed = extractJson(text);
  if (!parsed) return { ok: false, error: "Claude's answer was not the expected JSON." };
  return { ok: true, result: parsed };
}
