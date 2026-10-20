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
}

export interface OverviewResponse {
  dates: string[];
  employees: OverviewEmployee[];
}

export interface DayResponse {
  segments: Array<SegmentRow & { url: string | null }>;
  events: MicEventRow[];
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
