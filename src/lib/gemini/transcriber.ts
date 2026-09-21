// TRANSCRIBER — upload an mp4 from the browser, get back a verbatim transcript
// plus a deep read of the voice and the music.
//
// Split from lib/gemini/deconstruct.ts on purpose: that module analyses ads
// that already live on Facebook (server downloads a URL). Here the source is a
// file on the user's machine.
//
// The browser cannot POST the video to Gemini directly — the cross-origin
// upload is blocked in practice — and Vercel rejects any request body over
// 4.5MB before our code runs, so a single relayed upload is out too. Instead
// the file is relayed in chunks that each fit under that cap, using Gemini's
// resumable upload protocol. Same-origin the whole way, any file size.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

// Gemini's File API accepts 2GB, but a long video burns tokens fast and the
// analysis quality drops. 500MB comfortably covers any ad or UGC clip.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

// How long we wait for Gemini to finish pre-processing a video before it can
// be referenced in a prompt. Large files genuinely take a minute.
const FILE_ACTIVATION_TIMEOUT_MS = 180_000;
const FILE_POLL_INTERVAL_MS = 2_000;

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFFS_MS = [2_000, 6_000, 15_000];

function isTransientMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("overload") ||
    lower.includes("high demand") ||
    lower.includes("try again") ||
    lower.includes("unavailable") ||
    lower.includes("rate limit") ||
    lower.includes("resource exhausted")
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  let lastErrMsg = "";
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const bodyText = await res.clone().text().catch(() => "");
      const transient =
        TRANSIENT_STATUS.has(res.status) || isTransientMessage(bodyText);
      lastErrMsg = `${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`;
      if (!transient || attempt === RETRY_BACKOFFS_MS.length) return res;
      const delay = RETRY_BACKOFFS_MS[attempt];
      console.warn(
        `[transcriber] ${label} transient failure (attempt ${attempt + 1}) — retrying in ${delay}ms: ${lastErrMsg}`
      );
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      lastErrMsg = e instanceof Error ? e.message : "network error";
      if (attempt === RETRY_BACKOFFS_MS.length) throw e;
      const delay = RETRY_BACKOFFS_MS[attempt];
      console.warn(
        `[transcriber] ${label} network failure (attempt ${attempt + 1}) — retrying in ${delay}ms: ${lastErrMsg}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} failed after retries: ${lastErrMsg}`);
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

// Opens a resumable upload session and hands back the session URL. The URL is
// a one-shot, single-file token — it does NOT carry the API key, which is why
// it is safe to return to the browser.
export async function startUploadSession(
  displayName: string,
  mimeType: string,
  sizeBytes: number,
  apiKey: string
): Promise<string> {
  const res = await fetchWithRetry(
    `${GEMINI_API_BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    },
    "File API start"
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Could not start upload (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const uploadUrl = res.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini did not return an upload URL");
  return uploadUrl;
}

export interface UploadedFile {
  uri: string;
  name: string;
  mimeType: string;
}

// A Gemini upload session URL. Anything the client hands back to us gets
// checked against this before the server will POST bytes to it — the URL makes
// a round trip through the browser, so without this it is an open relay.
const UPLOAD_URL_PATTERN =
  /^https:\/\/generativelanguage\.googleapis\.com\/upload\/v1beta\/files\?/;

export function isValidUploadUrl(url: string): boolean {
  return UPLOAD_URL_PATTERN.test(url);
}

// Relays one chunk into an open resumable session. Gemini requires every
// non-final chunk to be a multiple of 256KB and to arrive in offset order;
// the finalising chunk is the one that returns the file metadata.
export async function uploadChunk(
  uploadUrl: string,
  chunk: ArrayBuffer,
  offset: number,
  isLast: boolean
): Promise<UploadedFile | null> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(chunk.byteLength),
      "X-Goog-Upload-Offset": String(offset),
      "X-Goog-Upload-Command": isLast ? "upload, finalize" : "upload",
    },
    body: chunk,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Upload rejected at ${(offset / 1024 / 1024).toFixed(1)}MB (${res.status}): ${text.slice(0, 200)}`
    );
  }
  // Intermediate chunks come back empty — only the finalising one carries the
  // file, and that is the only response worth parsing.
  if (!isLast) return null;

  const json = (await res.json().catch(() => null)) as {
    file?: { uri?: string; name?: string; mimeType?: string };
  } | null;
  const file = json?.file;
  if (!file?.uri || !file?.name) {
    throw new Error("Gemini finalised the upload but returned no file");
  }
  return {
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType ?? "video/mp4",
  };
}

// Gemini pre-processes video before it may be referenced in a prompt. A file
// used while still PROCESSING fails the generateContent call outright, so we
// block here until it flips to ACTIVE.
export async function waitUntilActive(
  fileName: string,
  apiKey: string
): Promise<string> {
  const deadline = Date.now() + FILE_ACTIVATION_TIMEOUT_MS;
  let state = "PROCESSING";
  let mimeType = "video/mp4";

  while (state !== "ACTIVE") {
    const res = await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`File poll failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { state?: string; mimeType?: string };
    state = json.state ?? state;
    if (json.mimeType) mimeType = json.mimeType;
    if (state === "FAILED") {
      throw new Error("Gemini could not process this video (FAILED).");
    }
    if (state === "ACTIVE") break;
    if (Date.now() > deadline) {
      throw new Error(
        `Gemini is still processing this video after ${FILE_ACTIVATION_TIMEOUT_MS / 1000}s. Try a shorter clip.`
      );
    }
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }
  return mimeType;
}

export async function deleteGeminiFile(
  fileName: string,
  apiKey: string
): Promise<void> {
  try {
    await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { method: "DELETE" }
    );
  } catch {
    // Non-fatal — Gemini auto-deletes uploaded files after 48h.
  }
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

export interface SpeakerProfile {
  label: string;
  perceived_gender: string;
  perceived_age_range: string;
  language_and_accent: string;
  tone: string[];
  tone_summary: string;
  emotional_arc: string;
  pace: string;
  pitch: string;
  energy: string;
  texture: string;
  delivery_style: string;
  recording_quality: string;
  casting_note: string;
}

export interface MusicProfile {
  present: boolean;
  summary: string;
  genre: string;
  subgenre_or_style: string;
  mood: string[];
  instrumentation: string[];
  tempo_bpm: string;
  key_or_tonality: string;
  rhythm_and_groove: string;
  arrangement: { t: string; description: string }[];
  vocals: string;
  production_and_era: string;
  mix_relationship_to_voice: string;
  sounds_like: string[];
  sourcing_guess: string;
}

export interface TranscriberAnalysis {
  title: string;
  language: string;
  duration_seconds: number;
  transcript: string;
  clean_transcript: string;
  speakers: SpeakerProfile[];
  overall_voice_tone: string;
  music: MusicProfile;
  sound_design: { t: string; description: string }[];
  audio_timeline: { t: string; description: string }[];
  audio_summary: string;
}

export interface TranscriberResult {
  analysis: TranscriberAnalysis;
  model: string;
  tokens_used: number | null;
}

const TIMESTAMPED_ITEMS = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      t: { type: "STRING", description: "Timestamp or range, e.g. '0:07' or '0:07-0:12'." },
      description: { type: "STRING" },
    },
    required: ["t", "description"],
  },
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: {
      type: "STRING",
      description: "A short 3-6 word label for this video, from what actually happens in it.",
    },
    language: {
      type: "STRING",
      description: "Spoken language(s), e.g. 'Taglish (Tagalog + English)'. Name the dominant one first.",
    },
    duration_seconds: { type: "NUMBER", description: "Video duration in seconds." },
    transcript: {
      type: "STRING",
      description:
        "Verbatim timestamped transcript of everything SPOKEN, in the original language — never translated. One line per utterance, formatted '0:03 SPEAKER 1: ...'. Use the same speaker labels as the speakers array. Mark non-speech audio events inline in brackets, e.g. '0:11 [laughs]', '0:14 [music swells]', '0:20 [silence]'. If nothing is spoken, write exactly: (No spoken words in this video.)",
    },
    clean_transcript: {
      type: "STRING",
      description:
        "The same spoken words with no timestamps and no speaker labels — flowing paragraphs, ready to copy and paste.",
    },
    speakers: {
      type: "ARRAY",
      description:
        "One entry per distinct voice heard, including voiceover artists and background speakers. Empty array if nobody speaks.",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING", description: "e.g. 'SPEAKER 1 (female voiceover)'." },
          perceived_gender: { type: "STRING", description: "How the voice reads, with a hedge if unclear." },
          perceived_age_range: { type: "STRING", description: "e.g. 'mid 20s to early 30s'." },
          language_and_accent: {
            type: "STRING",
            description: "Language, dialect and accent — e.g. 'Manila Tagalog, light American English code-switching'.",
          },
          tone: {
            type: "ARRAY",
            description: "4-8 precise tone adjectives, e.g. 'warm', 'urgent', 'conspiratorial', 'deadpan'. Not generic.",
            items: { type: "STRING" },
          },
          tone_summary: {
            type: "STRING",
            description: "2-3 sentences on how this voice sounds and the effect it has on the listener.",
          },
          emotional_arc: {
            type: "STRING",
            description: "How the emotion moves across the clip, with timestamps — e.g. 'calm at 0:00, tightens at 0:06, triumphant by 0:22'.",
          },
          pace: { type: "STRING", description: "Speaking speed with an approximate words-per-minute figure and any rushes or pauses." },
          pitch: { type: "STRING", description: "Pitch register and range — low/mid/high, flat or expressive, notable inflections." },
          energy: { type: "STRING", description: "Volume, projection and intensity, including dynamic changes." },
          texture: {
            type: "STRING",
            description: "Timbre of the voice itself: breathy, raspy, nasal, smooth, gravelly, bright, chesty, vocal fry.",
          },
          delivery_style: {
            type: "STRING",
            description: "Read style: scripted VO, conversational UGC selfie, hard-sell announcer, testimonial, ASMR, reading captions aloud.",
          },
          recording_quality: {
            type: "STRING",
            description: "Mic and processing: phone mic vs lav vs studio, room reverb, noise floor, compression, de-essing, EQ, whether it is dubbed/ADR over the visuals.",
          },
          casting_note: {
            type: "STRING",
            description: "One line telling a producer how to cast and direct someone to reproduce this voice.",
          },
        },
        required: [
          "label", "perceived_gender", "perceived_age_range", "language_and_accent",
          "tone", "tone_summary", "emotional_arc", "pace", "pitch", "energy",
          "texture", "delivery_style", "recording_quality", "casting_note",
        ],
      },
    },
    overall_voice_tone: {
      type: "STRING",
      description: "3-4 sentences on the overall tone of voice of the video as a whole, across all speakers.",
    },
    music: {
      type: "OBJECT",
      description: "Everything about the music bed. Be as specific as a music supervisor would be.",
      properties: {
        present: { type: "BOOLEAN", description: "False if there is no music at all." },
        summary: { type: "STRING", description: "3-4 sentences describing the track as you hear it." },
        genre: { type: "STRING", description: "Primary genre, e.g. 'lo-fi hip hop', 'corporate pop', 'trap'." },
        subgenre_or_style: { type: "STRING", description: "Narrower style tag, e.g. 'bright uplifting ukulele corporate', 'dark drill with 808 slides'." },
        mood: { type: "ARRAY", description: "4-8 mood adjectives for the music specifically.", items: { type: "STRING" } },
        instrumentation: {
          type: "ARRAY",
          description: "Every instrument or sound source you can identify, described concretely, e.g. 'plucked nylon guitar', 'sidechained analog pad', '808 sub with pitch slide', 'finger snaps'.",
          items: { type: "STRING" },
        },
        tempo_bpm: { type: "STRING", description: "Estimated tempo in BPM plus a feel word, e.g. '~124 BPM, driving'. Say so if it shifts." },
        key_or_tonality: { type: "STRING", description: "Key or tonality if identifiable, e.g. 'A minor', 'major, bright'. Hedge if unsure." },
        rhythm_and_groove: { type: "STRING", description: "Time signature, groove, swing, where the emphasis sits, whether cuts land on the beat." },
        arrangement: {
          ...TIMESTAMPED_ITEMS,
          description: "How the music changes across the video, with timestamps — entrances, drops, builds, risers, stings, when it ducks under the voice, when it stops.",
        },
        vocals: { type: "STRING", description: "Vocals in the music: none, wordless hooks, chanted, sung lyrics (quote them), male/female, processing used." },
        production_and_era: { type: "STRING", description: "Production style and era reference, e.g. '2020s TikTok-ready, heavily limited, wide stereo, modern pop mastering'." },
        mix_relationship_to_voice: { type: "STRING", description: "How music sits against the voice: level, sidechain/ducking, EQ carve, whether it fights the VO." },
        sounds_like: {
          type: "ARRAY",
          description: "2-4 reference tracks or artists it resembles, each with a short 'because…'. Say clearly that these are resemblances, not identifications.",
          items: { type: "STRING" },
        },
        sourcing_guess: {
          type: "STRING",
          description: "Where this track likely came from — TikTok/Reels trending audio, Epidemic Sound/Artlist-style stock, AI-generated, custom scored — and a search phrase to find something equivalent.",
        },
      },
      required: [
        "present", "summary", "genre", "subgenre_or_style", "mood", "instrumentation",
        "tempo_bpm", "key_or_tonality", "rhythm_and_groove", "arrangement", "vocals",
        "production_and_era", "mix_relationship_to_voice", "sounds_like", "sourcing_guess",
      ],
    },
    sound_design: {
      ...TIMESTAMPED_ITEMS,
      description: "Non-music, non-speech audio: whooshes, dings, cash-register stings, keyboard clicks, ambience, silence used as a beat. Empty array if none.",
    },
    audio_timeline: {
      ...TIMESTAMPED_ITEMS,
      description: "A beat-by-beat walkthrough of the audio from 0:00 to the end — what is heard in each segment across voice, music and effects together.",
    },
    audio_summary: {
      type: "STRING",
      description: "4-6 sentences tying it together: what this video sounds like and why the audio choices work (or do not).",
    },
  },
  required: [
    "title", "language", "duration_seconds", "transcript", "clean_transcript",
    "speakers", "overall_voice_tone", "music", "sound_design", "audio_timeline",
    "audio_summary",
  ],
} as const;

const SYSTEM_INSTRUCTION = `You are a transcriptionist and audio analyst working for a Philippine direct-response video team. You do two jobs on every clip: an exact transcript, and a forensic read of how it SOUNDS.

Rules:
- Transcribe verbatim in the original language. Never translate. Tagalog, Taglish and English code-switching are normal here — keep them exactly as spoken, including fillers and false starts.
- Transcribe only what is SPOKEN. On-screen text and captions are not transcript.
- Timestamps must be real. Never invent a line you did not hear.
- Describe voice and music concretely, the way a casting director and a music supervisor would. "Upbeat music" is a failure; "~128 BPM four-on-the-floor with plucked synth, claps on 2 and 4, sidechained pad under the VO" is the standard.
- You may say a track RESEMBLES a known song. Never assert you have identified it.
- When you are unsure, hedge in the field itself ("likely", "either X or Y") rather than inventing certainty, and say plainly when a segment is muted, inaudible or has no music.
- No padding. Every field does work.`;

const USER_PROMPT = `Transcribe this video and analyse its audio in full.

1. Produce the timestamped verbatim transcript of spoken words, plus a clean copy-paste version.
2. Profile every voice you hear: tone, emotional arc, pace, pitch, energy, timbre, accent, delivery style, and how it was recorded.
3. Profile the music in as much detail as you can: genre, subgenre, mood, instrument by instrument, tempo, key, groove, arrangement over time with timestamps, vocals, production era, how it sits against the voice, what it resembles, and where a producer would find a track like it.
4. List the sound design cues with timestamps, then walk the whole audio timeline start to finish.
5. Close with a short read of why the audio works or does not.

Return JSON matching the schema.`;

export async function analyzeVideoFile(
  fileUri: string,
  mimeType: string,
  apiKey: string
): Promise<TranscriberResult> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { mimeType, fileUri } },
          { text: USER_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      // A full transcript plus ~40 analysis fields. 8192 truncates long clips.
      maxOutputTokens: 32768,
    },
  };

  const res = await fetchWithRetry(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "generateContent"
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Gemini API error ${res.status}`);
  }

  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    // MAX_TOKENS with no text means the model spent the whole budget and
    // returned nothing usable — say so instead of "no text".
    const reason = candidate?.finishReason;
    throw new Error(
      reason === "MAX_TOKENS"
        ? "The video is too long for one pass — the analysis ran out of output budget. Try a shorter clip."
        : `Gemini returned no analysis${reason ? ` (${reason})` : ""}.`
    );
  }

  let analysis: TranscriberAnalysis;
  try {
    analysis = JSON.parse(text) as TranscriberAnalysis;
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }

  return {
    analysis,
    model: GEMINI_MODEL,
    tokens_used:
      (json?.usageMetadata?.totalTokenCount as number | undefined) ?? null,
  };
}
