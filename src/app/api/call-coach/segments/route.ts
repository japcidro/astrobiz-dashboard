import { activeConsent, requireRecordedEmployee } from "@/lib/call-coach/server";
import { CALL_COACH_BUCKET, SEGMENT_SECONDS, phDate } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

/**
 * POST multipart — one voiced segment from the browser recorder.
 * Fields: file, started_at, ended_at, voice_seconds, time_entry_id (optional).
 * The file goes to the private bucket; the row is what Phase 2 transcribes.
 */
export async function POST(request: Request) {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;

  if (!(await activeConsent(auth.db, auth.employee.id))) {
    return Response.json({ error: "Sign the recording consent first" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof Blob)) return Response.json({ error: "No audio in the request" }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Empty audio" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Audio file too large" }, { status: 413 });

  const startedAt = new Date(String(form.get("started_at") ?? ""));
  const endedAt = new Date(String(form.get("ended_at") ?? ""));
  const voiceSeconds = Number(form.get("voice_seconds"));
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || !Number.isFinite(voiceSeconds)) {
    return Response.json({ error: "Bad segment times" }, { status: 400 });
  }
  const durationSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  if (durationSeconds <= 0 || durationSeconds > SEGMENT_SECONDS * 3) {
    return Response.json({ error: "Bad segment length" }, { status: 400 });
  }

  const rawEntry = form.get("time_entry_id");
  const timeEntryId = typeof rawEntry === "string" && /^[0-9a-f-]{36}$/.test(rawEntry) ? rawEntry : null;

  const mime = (file.type.split(";")[0] || "audio/webm").toLowerCase();
  const ext = EXT[mime] ?? "webm";
  const date = phDate(startedAt);
  const path = `${auth.employee.id}/${date}/${startedAt.getTime()}.${ext}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await auth.db.storage.from(CALL_COACH_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) return Response.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });

  const { data, error } = await auth.db
    .from("call_coach_segments")
    .insert({
      employee_id: auth.employee.id,
      time_entry_id: timeEntryId,
      date,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: Math.round(durationSeconds * 10) / 10,
      voice_seconds: Math.round(Math.min(voiceSeconds, durationSeconds) * 10) / 10,
      storage_path: path,
      bytes: bytes.byteLength,
      mime,
    })
    .select("id")
    .single();
  if (error) {
    await auth.db.storage.from(CALL_COACH_BUCKET).remove([path]);
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ id: data.id });
}
