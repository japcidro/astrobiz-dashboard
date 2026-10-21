// Call Coach: constants and types shared by the browser recorder, the API
// routes and the owner page. Nothing here touches the server.

/** Private bucket; the app signs URLs for playback. */
export const CALL_COACH_BUCKET = "call-coach";

/** Audio is deleted this many days after it was recorded. Transcripts stay. */
export const RETENTION_DAYS = 60;

/** The recorder closes a file and starts a new one this often. */
export const SEGMENT_SECONDS = 60;

/** A segment with less speech than this is dropped as silence. */
export const MIN_VOICE_SECONDS = 3;

/** Roles whose shifts are recorded. Admin is here so the owner can test it. */
export const RECORDED_ROLES = ["va", "admin"] as const;

export const CONSENT_TEXT = `I agree that Astrobiz records my voice from my computer's microphone while I am clocked in on the dashboard, for quality and training purposes.

What is recorded: my side of customer calls and anything else my microphone hears while my timer is running. Recording pauses when I take a break and stops when I clock out. A red dot on the Time Tracker shows while it is on.

What happens to it: minutes with speech are stored securely; silent minutes are not kept. Recordings are deleted after 60 days. An AI writes transcripts and quality notes from them, which the owner and admins use to coach the team. Only the owner and admins can listen to the audio or read the transcripts.

I can ask the owner for a copy of this consent at any time.`;

export type MicEventKind =
  | "started"
  | "paused"
  | "resumed"
  | "lost"
  | "blocked"
  | "stopped"
  | "silent";

export interface CallCoachConsent {
  id: string;
  employee_id: string;
  signed_name: string;
  signed_at: string;
}

/** Where a recording came from: the PC-mic recorder, or a file the VA uploaded from her phone. */
export type SegmentSource = "pc_mic" | "phone_upload";

export interface SegmentRow {
  id: string;
  employee_id: string;
  time_entry_id: string | null;
  date: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  voice_seconds: number;
  storage_path: string;
  bytes: number;
  mime: string;
  status: "stored" | "transcribed" | "scored" | "failed";
  transcribe_attempts: number;
  transcribe_error: string | null;
  source: SegmentSource;
  /** Order number or customer phone the VA typed with a phone upload. */
  reference: string | null;
  original_name: string | null;
}

// ─── Phone uploads: a VA with no signal at her desk calls from her phone ───

/** One phone recording may be this big. The bucket enforces the same cap. */
export const PHONE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** A phone recording longer than this is almost certainly not one call. */
export const PHONE_UPLOAD_MAX_SECONDS = 4 * 60 * 60;

/**
 * What the phone's file picker offers and what the bucket accepts. Android
 * call recorders write m4a, aac, amr or mp3; iPhone Voice Memos writes m4a.
 */
export const PHONE_UPLOAD_ACCEPT = ".m4a,.mp3,.aac,.ogg,.oga,.opus,.amr,.awb,.3gp,.wav,.webm,.flac,audio/*";

export const PHONE_UPLOAD_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  amr: "audio/amr",
  awb: "audio/amr-wb",
  "3gp": "audio/3gpp",
  wav: "audio/wav",
  webm: "audio/webm",
  flac: "audio/flac",
};

/** The MIME type a phone file goes to the bucket (and to Gemini) as, by its extension; null when it is not audio we take. */
export function phoneUploadMime(fileName: string, browserType?: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (PHONE_UPLOAD_EXT[ext]) return PHONE_UPLOAD_EXT[ext];
  const t = (browserType ?? "").split(";")[0].trim().toLowerCase();
  if (t === "audio/x-m4a" || t === "audio/m4a") return "audio/mp4";
  if (t === "audio/mp3") return "audio/mpeg";
  if (t === "audio/x-wav" || t === "audio/wave") return "audio/wav";
  if (t === "video/3gpp") return "audio/3gpp";
  if (Object.values(PHONE_UPLOAD_EXT).includes(t)) return t;
  return null;
}

export interface MicEventRow {
  id: string;
  kind: MicEventKind;
  at: string;
  detail: string | null;
}

/** One cell of the owner overview: a VA's day. */
export interface DayTotals {
  segments: number;
  voice_seconds: number;
  first_at: string;
  last_at: string;
}

export interface OverviewEmployee {
  id: string;
  full_name: string;
  role: string;
  consented_at: string | null;
  days: Record<string, DayTotals>;
  reviews: Record<string, DayReviewSummary>;
}

export interface OverviewResponse {
  dates: string[];
  employees: OverviewEmployee[];
}

export interface DayResponse {
  segments: Array<SegmentRow & { url: string | null; transcript: TranscriptRow | null }>;
  events: MicEventRow[];
  review: ReviewRow | null;
  calls: CallRow[];
}

/** A moment's calendar date in the Philippines (UTC+8), as YYYY-MM-DD. */
export function phDate(at: Date = new Date()): string {
  const pht = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

export const formatMinutes = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

// ─── Phase 2: transcripts and scores ───

export const TRANSCRIBE_MODEL = "gemini-2.5-flash";
export const REVIEW_MODEL = "claude-sonnet-5-5";

/** app_settings key for an owner-edited rubric; DEFAULT_RUBRIC when unset. */
export const RUBRIC_SETTING_KEY = "call_coach_rubric";

export const RUBRIC_ITEMS = [
  { key: "greeting", label: "Greeting & intro" },
  { key: "confirmation", label: "Order confirmation" },
  { key: "upsell", label: "Upsell attempt" },
  { key: "objection", label: "Objection handling" },
  { key: "tone", label: "Tone & courtesy" },
  { key: "closing", label: "Closing & delivery reminder" },
] as const;

export type RubricKey = (typeof RUBRIC_ITEMS)[number]["key"];

export const DEFAULT_RUBRIC = `Score each call 1 to 5 on these six items. Leave an item null when the call never reached that stage (a no-answer has no closing).

1. Greeting & intro (greeting): Names the store, names the customer, says why they are calling, all within the first 10 seconds. 5 = all three, warm. 3 = two of three. 1 = jumps straight into the order with no intro.
   Good: "Hi ma'am Joy, si Ana po ito from I Love Patches, tumatawag po ako about sa order niyo."

2. Order confirmation (confirmation): Repeats the items, quantity, COD total, full address and a landmark, and catches mismatches. 5 = everything repeated and confirmed. 3 = items and total only. 1 = asks "confirm po?" without reading anything back.
   Good: "2 boxes po, 1,180 COD, Brgy. San Isidro, malapit sa chapel, tama po?"

3. Upsell attempt (upsell): Offers a bundle or add-on tied to a benefit. 5 = offered, tied to a benefit, handled the answer well. 3 = offered flatly ("gusto niyo pa po?"). 1 = no attempt on a reachable, willing customer. Null when the customer cancelled before an offer made sense.

4. Objection handling (objection): "Pag-iisipan ko pa", "mahal", "cancel na lang", "hindi ako ang umorder", wrong address. 5 = acknowledged, reassured, gave a reason to decide today, kept the order or set a real callback. 3 = acknowledged but gave up at the first no. 1 = argued, or ended the call with nothing settled. Null when the customer raised nothing.

5. Tone & courtesy (tone): Patience, po/opo, not talking over, not rushed. 5 = warm and unhurried throughout. 3 = fine but mechanical. 1 = curt, rushed or irritated.

6. Closing & delivery reminder (closing): States the delivery window, asks them to keep the phone on, reminds them to prepare the COD amount and accept the parcel. 5 = all of it. 3 = delivery window only. 1 = "sige po, bye" with nothing set.

Flags to raise when you see them: rts_risk (customer stayed unsure or unreachable after a hesitation), no_upsell (reachable happy customer, no offer), rushed (noticeably shorter or curt late in the shift), wrong_info (VA stated a price, item or policy that contradicts the order), great_call (worth using as a training clip).`;

export interface TranscriptTurn {
  /** Seconds into the segment. */
  t: number;
  speaker: "va" | "customer" | "other";
  text: string;
}

export interface TranscriptRow {
  id: string;
  segment_id: string;
  language: string | null;
  text: string;
  turns: TranscriptTurn[];
  tokens: number | null;
}

export type CallOutcome = "confirmed" | "cancelled" | "callback" | "no_answer" | "wrong_number" | "not_sales" | "unclear";

export interface CallMoment {
  at: string;
  tag: string;
  note: string;
  quote: string | null;
}

export interface CallRow {
  id: string;
  position: number;
  source: SegmentSource;
  started_at: string;
  ended_at: string;
  outcome: CallOutcome;
  customer_audible: boolean;
  scores: Partial<Record<RubricKey, number | null>>;
  overall: number | null;
  summary: string;
  upsell_attempted: boolean;
  upsell_converted: boolean;
  flags: string[];
  moments: CallMoment[];
}

export interface ReviewRow {
  id: string;
  employee_id: string;
  date: string;
  status: "queued" | "running" | "done" | "failed";
  model: string | null;
  segments_count: number;
  voice_seconds: number;
  reviewed_through: string | null;
  calls_count: number;
  reached_count: number;
  confirmed_count: number;
  upsell_attempted: number;
  upsell_converted: number;
  score: number | null;
  scores: Partial<Record<RubricKey, number | null>>;
  summary: string | null;
  coaching: string[];
  non_call_notes: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  updated_at: string;
}

/** What the overview shows in a day cell once a review exists. */
export interface DayReviewSummary {
  score: number | null;
  calls: number;
  status: ReviewRow["status"];
  /** Segments still waiting for a transcript. */
  pending: number;
}

export const scoreTone = (score: number | null | undefined): "good" | "mid" | "bad" | "none" => {
  if (score === null || score === undefined) return "none";
  if (score >= 4) return "good";
  if (score >= 3) return "mid";
  return "bad";
};

// ─── Phase 3: the Monday digest, alerts, the VA's own view ───

export const DIGEST_MODEL = "claude-opus-5-5";

export interface TrainingClip {
  date: string;
  at: string;
  note: string;
}

export interface DigestRow {
  id: string;
  employee_id: string;
  week_start: string;
  week_end: string;
  status: "queued" | "running" | "done" | "failed";
  model: string | null;
  days_reviewed: number;
  calls_count: number;
  reached_count: number;
  confirmed_count: number;
  upsell_attempted: number;
  upsell_converted: number;
  score: number | null;
  prev_score: number | null;
  scores: Partial<Record<RubricKey, number | null>>;
  summary: string | null;
  wins: string[];
  coaching: string[];
  training_clips: TrainingClip[];
  va_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  updated_at: string;
}

/** The Monday of the Manila week that holds this YYYY-MM-DD. */
export function phWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
