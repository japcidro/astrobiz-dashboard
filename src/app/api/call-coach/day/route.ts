import { requireCoach, signSegmentPaths } from "@/lib/call-coach/server";
import type { DayResponse, MicEventRow, SegmentRow } from "@/lib/call-coach/shared";

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

  const [{ data: segments }, { data: events }] = await Promise.all([
    auth.db.from("call_coach_segments").select("*").eq("employee_id", employeeId).eq("date", date).order("started_at"),
    auth.db.from("call_coach_mic_events").select("id, kind, at, detail").eq("employee_id", employeeId).eq("date", date).order("at"),
  ]);

  const rows = (segments ?? []) as SegmentRow[];
  const signed = await signSegmentPaths(auth.db, rows.map((r) => r.storage_path));
  const body: DayResponse = {
    segments: rows.map((r) => ({ ...r, voice_seconds: Number(r.voice_seconds), duration_seconds: Number(r.duration_seconds), url: signed.get(r.storage_path) ?? null })),
    events: (events ?? []) as MicEventRow[],
  };
  return Response.json(body);
}
