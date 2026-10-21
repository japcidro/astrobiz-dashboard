import { activeConsent, requireRecordedEmployee, shiftEntryAt } from "@/lib/call-coach/server";
import { CALL_COACH_BUCKET, PHONE_UPLOAD_MAX_BYTES, PHONE_UPLOAD_MAX_SECONDS, addDays, phDate, phoneUploadMime } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

const PATH_RE = /^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/phone-\d+-[0-9a-f]{8}\.[a-z0-9]{2,4}$/;

export interface PhoneUploadRow {
  id: string;
  date: string;
  started_at: string;
  duration_seconds: number;
  status: "stored" | "transcribed" | "scored" | "failed";
  transcribe_error: string | null;
  reference: string | null;
  original_name: string | null;
  created_at: string;
  /** The day's review is done, so the call is on My Calls. */
  reviewed: boolean;
}

/** GET — the VA's own phone uploads from the last 14 days, newest first. */
export async function GET() {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;
  const since = addDays(phDate(), -14);
  const { data: rows, error } = await auth.db
    .from("call_coach_segments")
    .select("id, date, started_at, duration_seconds, status, transcribe_error, reference, original_name, created_at")
    .eq("employee_id", auth.employee.id)
    .eq("source", "phone_upload")
    .gte("date", since)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const dates = Array.from(new Set((rows ?? []).map((r) => r.date as string)));
  const { data: reviews } = dates.length
    ? await auth.db.from("call_coach_reviews").select("date").eq("employee_id", auth.employee.id).eq("status", "done").in("date", dates)
    : { data: [] };
  const reviewed = new Set((reviews ?? []).map((r) => r.date as string));
  const uploads: PhoneUploadRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    date: r.date as string,
    started_at: r.started_at as string,
    duration_seconds: Number(r.duration_seconds),
    status: r.status as PhoneUploadRow["status"],
    transcribe_error: (r.transcribe_error as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    original_name: (r.original_name as string | null) ?? null,
    created_at: r.created_at as string,
    reviewed: reviewed.has(r.date as string),
  }));
  return Response.json({ uploads });
}

/**
 * POST { path, original_name, type, started_at, duration_seconds, reference }
 * Step two of a phone upload: the file is in the bucket, so make it a
 * segment row. From here on it is a PC-mic minute as far as transcription,
 * the nightly review and the Monday digest are concerned.
 */
export async function POST(request: Request) {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;
  if (!(await activeConsent(auth.db, auth.employee.id))) {
    return Response.json({ error: "Sign the recording consent first" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { path?: string; original_name?: string; type?: string; started_at?: string; duration_seconds?: number | null; reference?: string | null }
    | null;
  const path = String(body?.path ?? "");
  if (!PATH_RE.test(path) || !path.startsWith(`${auth.employee.id}/`)) return Response.json({ error: "Bad upload path" }, { status: 400 });
  const originalName = String(body?.original_name ?? "").trim().slice(0, 200) || null;
  const mime = phoneUploadMime(originalName ?? path, body?.type) ?? "audio/mp4";

  const startedAt = new Date(String(body?.started_at ?? ""));
  if (Number.isNaN(startedAt.getTime()) || startedAt.getTime() > Date.now() + 10 * 60 * 1000) {
    return Response.json({ error: "Set when the call started" }, { status: 400 });
  }

  // Already registered (a retry after a lost response): return that row.
  const { data: existing } = await auth.db.from("call_coach_segments").select("id, status").eq("storage_path", path).maybeSingle();
  if (existing) return Response.json({ id: existing.id, status: existing.status });

  const info = await auth.db.storage.from(CALL_COACH_BUCKET).info(path);
  if (info.error || !info.data) return Response.json({ error: "The file did not arrive. Upload it again." }, { status: 400 });
  const bytes = Number(info.data.size ?? 0);
  if (bytes <= 0 || bytes > PHONE_UPLOAD_MAX_BYTES) {
    await auth.db.storage.from(CALL_COACH_BUCKET).remove([path]);
    return Response.json({ error: "The file is empty or too large" }, { status: 400 });
  }

  // The phone reads the length for most formats. AMR will not play in a
  // browser, so for it the length is an estimate from the file size.
  const given = Number(body?.duration_seconds);
  let durationSeconds = Number.isFinite(given) && given > 0 ? given : bytes / (mime.startsWith("audio/amr") || mime === "audio/3gpp" ? 1600 : 8000);
  durationSeconds = Math.min(Math.max(durationSeconds, 1), PHONE_UPLOAD_MAX_SECONDS);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const date = phDate(startedAt);
  const reference = String(body?.reference ?? "").trim().slice(0, 80) || null;

  const { data, error } = await auth.db
    .from("call_coach_segments")
    .insert({
      employee_id: auth.employee.id,
      time_entry_id: await shiftEntryAt(auth.db, auth.employee.id, startedAt),
      date,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: Math.round(durationSeconds * 10) / 10,
      // A phone call is talk from end to end; there is no silence gate on the phone.
      voice_seconds: Math.round(durationSeconds * 10) / 10,
      storage_path: path,
      bytes,
      mime,
      source: "phone_upload",
      reference,
      original_name: originalName,
    })
    .select("id, status")
    .single();
  if (error) {
    await auth.db.storage.from(CALL_COACH_BUCKET).remove([path]);
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ id: data.id, status: data.status, date });
}
