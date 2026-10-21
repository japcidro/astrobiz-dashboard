import type { SupabaseClient } from "@supabase/supabase-js";
import { startUploadSession, uploadChunk, waitUntilActive } from "@/lib/gemini/transcriber";
import { CALL_COACH_BUCKET, TRANSCRIBE_MODEL, type SegmentSource, type TranscriptTurn } from "./shared";

/**
 * Call Coach transcription: one Gemini call per stored segment. A PC-mic
 * segment is at most a minute of audio (about 250 KB), so it travels inline
 * in the request. A phone upload is a whole call and can be tens of MB; past
 * INLINE_MAX_BYTES it goes through Gemini's File API first. Taglish stays
 * Taglish.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const MAX_ATTEMPTS = 3;
/** Gemini takes 20 MB of inline request; base64 adds a third, so 14 MB of audio is the ceiling. */
const INLINE_MAX_BYTES = 14 * 1024 * 1024;
/** Give the browser time to finish uploading the current minute before we read it. */
const SETTLE_SECONDS = 60;

export async function settingValue(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value as unknown;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const SYSTEM_INSTRUCTION = `You transcribe short audio clips recorded by the laptop microphone of a Filipino ecommerce VA (virtual assistant) during their shift. The VA phones customers to confirm cash-on-delivery orders, answers questions and follows up. Calls are in Taglish: Filipino mixed with English.

Rules:
- Transcribe verbatim in the words spoken. Keep Filipino as Filipino and English as English. Do not translate. Use standard Filipino spelling; numbers as digits (1,180, 2 boxes).
- The VA is the loud, close voice. A customer is only audible when the phone is on loudspeaker: a quieter, thinner, phone-like voice. Label those turns "customer". Anyone else in the room, TV or radio is "other".
- Start a new turn whenever the speaker changes or after a clear pause. Give each turn its start time in seconds from the start of the clip, to one decimal.
- Mark unintelligible words as [unclear]. Do not invent words. If the clip has no speech, return an empty turns list.
- language: what you heard most: "taglish", "tagalog", "english", "bisaya", or "none".`;

/** Added for a call the VA recorded on her phone and uploaded: the mix is different from the PC mic. */
const PHONE_INSTRUCTION = `This clip is one phone call the VA made from her mobile phone and uploaded herself, not the laptop microphone. Both sides are usually audible at similar volume: the VA is the one who names the store and reads the order back; the other voice is the customer, label it "customer" even when it is clear and loud. Keep dialing tones, ringing and voicemail prompts out of the turns.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    turns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          t: { type: "number", description: "Seconds from the start of the clip" },
          speaker: { type: "string", enum: ["va", "customer", "other"] },
          text: { type: "string" },
        },
        required: ["t", "speaker", "text"],
      },
    },
  },
  required: ["language", "turns"],
};

export interface Transcription {
  language: string;
  turns: TranscriptTurn[];
  text: string;
  tokens: number | null;
}

export function renderTranscript(turns: TranscriptTurn[]): string {
  const label = { va: "VA", customer: "CUSTOMER", other: "OTHER" } as const;
  return turns
    .map((turn) => {
      const m = Math.floor(turn.t / 60);
      const s = Math.floor(turn.t % 60);
      return `[${m}:${String(s).padStart(2, "0")}] ${label[turn.speaker] ?? "OTHER"}: ${turn.text}`;
    })
    .join("\n");
}

/** Puts a big clip in Gemini's File API and waits until it can be referenced. */
async function uploadToGeminiFile(apiKey: string, bytes: Uint8Array, mime: string): Promise<{ uri: string; name: string }> {
  const sessionUrl = await startUploadSession("call-coach-phone-upload", mime, bytes.byteLength, apiKey);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = await uploadChunk(sessionUrl, buffer, 0, true);
  if (!file) throw new Error("Gemini did not return the uploaded file");
  await waitUntilActive(file.name, apiKey);
  return { uri: file.uri, name: file.name };
}

export async function transcribeAudio(
  apiKey: string,
  bytes: Uint8Array,
  mime: string,
  opts: { source?: SegmentSource } = {},
): Promise<Transcription> {
  const phone = opts.source === "phone_upload";
  let geminiFile: { uri: string; name: string } | null = null;
  const audioPart =
    bytes.byteLength > INLINE_MAX_BYTES
      ? { fileData: { mimeType: mime, fileUri: (geminiFile = await uploadToGeminiFile(apiKey, bytes, mime)).uri } }
      : { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } };
  const body = {
    systemInstruction: { parts: [{ text: phone ? `${SYSTEM_INSTRUCTION}\n\n${PHONE_INSTRUCTION}` : SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [audioPart, { text: "Transcribe this clip. Return JSON matching the schema." }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
      // A PC-mic minute needs a few hundred tokens; a 30-minute phone call can need 20k.
      maxOutputTokens: phone ? 32768 : 8192,
    },
  };

  const res = await fetch(`${GEMINI_API_BASE}/v1beta/models/${TRANSCRIBE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (geminiFile) {
    // Gemini drops it after 48 hours anyway; this just keeps the file list clean.
    void fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}?key=${encodeURIComponent(apiKey)}`, { method: "DELETE" }).catch(() => {});
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { totalTokenCount?: number };
  };
  if (!res.ok) throw new Error(json?.error?.message ?? `Gemini ${res.status}`);

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error(`Gemini returned no transcript${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}`);

  let parsed: { language?: string; turns?: Array<Partial<TranscriptTurn>> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini transcript was not valid JSON");
  }
  const turns: TranscriptTurn[] = (parsed.turns ?? [])
    .filter((t) => typeof t.text === "string" && t.text.trim())
    .map(
      (t): TranscriptTurn => ({
        t: Math.max(0, Number(t.t) || 0),
        speaker: t.speaker === "customer" || t.speaker === "other" ? t.speaker : "va",
        text: String(t.text).trim(),
      }),
    )
    .sort((a, b) => a.t - b.t);

  return {
    language: typeof parsed.language === "string" ? parsed.language.toLowerCase() : "none",
    turns,
    text: renderTranscript(turns),
    tokens: json.usageMetadata?.totalTokenCount ?? null,
  };
}

interface PendingSegment {
  id: string;
  employee_id: string;
  date: string;
  storage_path: string;
  mime: string;
  transcribe_attempts: number;
  source: SegmentSource;
}

export interface BatchFilter {
  employeeId?: string;
  date?: string;
}

export interface BatchResult {
  processed: number;
  failed: number;
  skipped: string | null;
}

/**
 * Transcribes stored segments oldest first until the limit or the deadline.
 * Each segment is tried up to MAX_ATTEMPTS times before it is marked failed.
 */
export async function runTranscriptionBatch(
  db: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number; concurrency?: number; filter?: BatchFilter } = {},
): Promise<BatchResult> {
  const { limit = 60, deadlineMs = 240_000, concurrency = 4, filter } = opts;
  const apiKey = await settingValue(db, "gemini_api_key");
  if (!apiKey) return { processed: 0, failed: 0, skipped: "No Gemini API key in Settings" };

  let q = db
    .from("call_coach_segments")
    .select("id, employee_id, date, storage_path, mime, transcribe_attempts, source")
    .eq("status", "stored")
    .lt("transcribe_attempts", MAX_ATTEMPTS)
    .lt("ended_at", new Date(Date.now() - SETTLE_SECONDS * 1000).toISOString())
    .order("started_at")
    .limit(limit);
  if (filter?.employeeId) q = q.eq("employee_id", filter.employeeId);
  if (filter?.date) q = q.eq("date", filter.date);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const queue = (data ?? []) as PendingSegment[];
  const started = Date.now();
  let processed = 0;
  let failed = 0;

  const worker = async () => {
    while (queue.length > 0 && Date.now() - started < deadlineMs) {
      const seg = queue.shift()!;
      const ok = await transcribeSegment(db, apiKey, seg);
      if (ok) processed += 1;
      else failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { processed, failed, skipped: null };
}

async function transcribeSegment(db: SupabaseClient, apiKey: string, seg: PendingSegment): Promise<boolean> {
  try {
    const dl = await db.storage.from(CALL_COACH_BUCKET).download(seg.storage_path);
    if (dl.error || !dl.data) throw new Error(`Download failed: ${dl.error?.message ?? "no data"}`);
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const result = await transcribeAudio(apiKey, bytes, seg.mime || "audio/webm", { source: seg.source });

    const { error: upsertError } = await db.from("call_coach_transcripts").upsert(
      {
        segment_id: seg.id,
        employee_id: seg.employee_id,
        date: seg.date,
        model: TRANSCRIBE_MODEL,
        language: result.language,
        text: result.text,
        turns: result.turns,
        tokens: result.tokens,
      },
      { onConflict: "segment_id" },
    );
    if (upsertError) throw new Error(upsertError.message);

    await db
      .from("call_coach_segments")
      .update({ status: "transcribed", transcribe_attempts: seg.transcribe_attempts + 1, transcribe_error: null })
      .eq("id", seg.id);
    return true;
  } catch (e) {
    const attempts = seg.transcribe_attempts + 1;
    const message = (e instanceof Error ? e.message : "Transcription failed").slice(0, 500);
    await db
      .from("call_coach_segments")
      .update({
        transcribe_attempts: attempts,
        transcribe_error: message,
        ...(attempts >= MAX_ATTEMPTS ? { status: "failed" } : {}),
      })
      .eq("id", seg.id);
    console.error(`[call-coach] transcribe ${seg.id} attempt ${attempts}: ${message}`);
    return false;
  }
}
