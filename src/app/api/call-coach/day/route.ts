import { requireCoach, signSegmentPaths } from "@/lib/call-coach/server";
import type { CallRow, DayResponse, MicEventRow, ReviewRow, SegmentRow, TranscriptRow } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

/** GET ?employee_id&date — one VA's day: every stored segment with a playback URL, plus mic events. */
export async function GET(request: Request) {
  const auth = await requireCoach();
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employee_id") ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Pick an employee and a date" }, { status: 400 });
  }

  const [{ data: segments }, { data: events }, { data: transcripts }, { data: review }] = await Promise.all([
    auth.db.from("call_coach_segments").select("*").eq("employee_id", employeeId).eq("date", date).order("started_at"),
    auth.db.from("call_coach_mic_events").select("id, kind, at, detail").eq("employee_id", employeeId).eq("date", date).order("at"),
    auth.db.from("call_coach_transcripts").select("id, segment_id, language, text, turns, tokens").eq("employee_id", employeeId).eq("date", date),
    auth.db.from("call_coach_reviews").select("*").eq("employee_id", employeeId).eq("date", date).maybeSingle(),
  ]);
  const { data: calls } = review
    ? await auth.db.from("call_coach_calls").select("*").eq("review_id", (review as ReviewRow).id).order("position")
    : { data: [] as CallRow[] };

  const rows = (segments ?? []) as SegmentRow[];
  const transcriptBy = new Map<string, TranscriptRow>();
  for (const t of (transcripts ?? []) as TranscriptRow[]) transcriptBy.set(t.segment_id, t);
  const signed = await signSegmentPaths(auth.db, rows.map((r) => r.storage_path));
  const rev = (review as ReviewRow | null) ?? null;
  const body: DayResponse = {
    segments: rows.map((r) => ({
      ...r,
      voice_seconds: Number(r.voice_seconds),
      duration_seconds: Number(r.duration_seconds),
      url: signed.get(r.storage_path) ?? null,
      transcript: transcriptBy.get(r.id) ?? null,
    })),
    events: (events ?? []) as MicEventRow[],
    review: rev ? { ...rev, score: rev.score === null ? null : Number(rev.score), voice_seconds: Number(rev.voice_seconds) } : null,
    calls: ((calls ?? []) as CallRow[]).map((c) => ({ ...c, overall: c.overall === null ? null : Number(c.overall) })),
  };
  return Response.json(body);
}
