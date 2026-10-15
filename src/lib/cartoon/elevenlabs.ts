import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import type { CartoonBeatRow, CartoonHookRow, CartoonVoice } from "./types";

/**
 * The team's own ElevenLabs account (where the FOLIQ voices live). The key is
 * ELEVENLABS_API_KEY on Vercel, the same one the call confirmer uses, so these
 * lines are made by the app, not by the Mac worker. They use the account's
 * ElevenLabs characters, not Higgsfield credits.
 */

const API = "https://api.elevenlabs.io/v1";
// Eleven v4 (Sep 2026): clones are more faithful than on multilingual v2. It only takes stability and similarity.
const MODEL = "eleven_v4";
const SETTINGS = { stability: 0.5, similarity_boost: 0.75 };
const OWN = ["cloned", "generated", "professional"];

const key = () => process.env.ELEVENLABS_API_KEY ?? null;

/** The account's own voices (cloned, designed, professional), the "v4" voices made for Eleven v4 first, then A to Z; ElevenLabs' stock voices are left out. */
export async function listElevenLabsVoices(): Promise<{ voices: CartoonVoice[]; error: string | null }> {
  const apiKey = key();
  if (!apiKey) return { voices: [], error: "ELEVENLABS_API_KEY is not set" };
  try {
    const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey }, cache: "no-store" });
    if (!res.ok) return { voices: [], error: `ElevenLabs ${res.status}` };
    const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string }> };
    const voices = (data.voices ?? [])
      .filter((v) => OWN.includes(v.category ?? ""))
      .map((v) => ({ provider: "elevenlabs" as const, id: v.voice_id, name: v.name.trim(), type: v.category ?? "cloned" }))
      .sort((a, b) => Number(/\bv4\b/i.test(b.name)) - Number(/\bv4\b/i.test(a.name)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return { voices, error: null };
  } catch (e) {
    return { voices: [], error: e instanceof Error ? e.message : "ElevenLabs unreachable" };
  }
}

/** One beat's line: MP3 into storage, its length from ElevenLabs' character timings. */
async function speakBeat(db: SupabaseClient, hook: CartoonHookRow, beat: CartoonBeatRow, apiKey: string): Promise<void> {
  // Claim it (null → running) so two page loads never voice the same beat twice.
  const { data: claimed } = await db.from("cartoon_beats").update({ voice_status: "running", voice_error: null }).eq("id", beat.id).is("voice_status", null).select("id");
  if (!claimed?.length) return;
  try {
    const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(hook.voice_id!)}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: beat.line, model_id: MODEL, voice_settings: SETTINGS }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { audio_base64?: string; alignment?: { character_end_times_seconds?: number[] } | null };
    if (!data.audio_base64) throw new Error("ElevenLabs returned no audio");
    const audio = Buffer.from(data.audio_base64, "base64");
    const ends = data.alignment?.character_end_times_seconds ?? [];
    // Spoken length from the timings; else from the bitrate (128 kbps).
    const seconds = ends.length ? Math.max(...ends) : (audio.byteLength * 8) / 128_000;
    const path = `cartoon-hooks/${hook.id}/voice-${beat.id}-${Date.now()}.mp3`;
    const up = await db.storage.from(BOARD_BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await db
      .from("cartoon_beats")
      .update({ voice_path: path, voice_seconds: Math.round(seconds * 100) / 100, voice_status: "done", voice_error: null, voice_credits: null })
      .eq("id", beat.id);
  } catch (e) {
    await db.from("cartoon_beats").update({ voice_status: "failed", voice_error: (e instanceof Error ? e.message : "Voiceover failed").slice(0, 500) }).eq("id", beat.id);
  }
}

/**
 * Voice every beat of an ElevenLabs hook that has not been voiced yet (status
 * null), three at a time. The worker joins the hook once every line is done
 * or failed, so a failure here never blocks the hook.
 */
export async function voiceElevenLabsBeats(db: SupabaseClient, hookId: string): Promise<void> {
  const { data } = await db.from("cartoon_hooks").select("*").eq("id", hookId).maybeSingle();
  const hook = data as CartoonHookRow | null;
  if (!hook || !hook.voice_on || hook.voice_provider !== "elevenlabs" || !hook.voice_id) return;
  // A line left "running" by a request that was cut off is tried again.
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  await db.from("cartoon_beats").update({ voice_status: null }).eq("hook_id", hookId).eq("voice_status", "running").lt("updated_at", stale);
  const { data: rows } = await db.from("cartoon_beats").select("*").eq("hook_id", hookId).is("voice_status", null).order("idx");
  const beats = ((rows ?? []) as CartoonBeatRow[]).filter((b) => b.line.trim());
  if (beats.length === 0) return;
  const apiKey = key();
  if (!apiKey) {
    await db.from("cartoon_beats").update({ voice_status: "failed", voice_error: "ELEVENLABS_API_KEY is not set on the server" }).in("id", beats.map((b) => b.id));
    return;
  }
  const queue = [...beats];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) await speakBeat(db, hook, queue.shift()!, apiKey);
  }));
}
