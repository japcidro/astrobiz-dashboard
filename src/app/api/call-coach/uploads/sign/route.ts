import { randomUUID } from "node:crypto";
import { activeConsent, requireRecordedEmployee } from "@/lib/call-coach/server";
import { CALL_COACH_BUCKET, PHONE_UPLOAD_MAX_BYTES, phDate, phoneUploadMime } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

/** How far back a phone recording may be dated. Audio is deleted after 60 days anyway. */
const MAX_AGE_DAYS = 30;
const EXT_FOR: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/amr": "amr",
  "audio/amr-wb": "awb",
  "audio/3gpp": "3gp",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

/**
 * POST { name, size, type, started_at } — step one of a phone upload: a
 * signed URL the phone PUTs the file to, straight into the private bucket.
 * A Vercel function cannot take a 100 MB body, so the bytes never pass
 * through here. Step two is POST /api/call-coach/uploads with the path.
 */
export async function POST(request: Request) {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;
  if (!(await activeConsent(auth.db, auth.employee.id))) {
    return Response.json({ error: "Sign the recording consent first" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { name?: string; size?: number; type?: string; started_at?: string } | null;
  const name = (body?.name ?? "").trim().slice(0, 200);
  const size = body?.size;
  if (!name || typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return Response.json({ error: "Pick an audio file" }, { status: 400 });
  }
  if (size > PHONE_UPLOAD_MAX_BYTES) {
    return Response.json({ error: `That file is ${Math.round(size / 1024 / 1024)} MB; the limit is ${PHONE_UPLOAD_MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }
  const mime = phoneUploadMime(name, body?.type);
  if (!mime) return Response.json({ error: "Use an audio file: m4a, mp3, aac, ogg, amr, wav or webm" }, { status: 415 });

  const startedAt = new Date(String(body?.started_at ?? ""));
  if (Number.isNaN(startedAt.getTime())) return Response.json({ error: "Set when the call started" }, { status: 400 });
  const ageMs = Date.now() - startedAt.getTime();
  if (ageMs < -10 * 60 * 1000) return Response.json({ error: "The call time is in the future" }, { status: 400 });
  if (ageMs > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    return Response.json({ error: `Calls older than ${MAX_AGE_DAYS} days cannot be uploaded` }, { status: 400 });
  }

  // The same file picked twice: say so instead of storing it again.
  const { data: dupe } = await auth.db
    .from("call_coach_segments")
    .select("id, status")
    .eq("employee_id", auth.employee.id)
    .eq("source", "phone_upload")
    .eq("original_name", name)
    .eq("bytes", size)
    .limit(1)
    .maybeSingle();
  if (dupe) return Response.json({ duplicate: true, id: dupe.id, status: dupe.status });

  const ext = EXT_FOR[mime] ?? "m4a";
  const path = `${auth.employee.id}/${phDate(startedAt)}/phone-${startedAt.getTime()}-${randomUUID().slice(0, 8)}.${ext}`;
  const { data, error } = await auth.db.storage.from(CALL_COACH_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return Response.json({ error: `Could not start the upload: ${error?.message ?? "no URL"}` }, { status: 500 });
  return Response.json({ path, signed_url: data.signedUrl, mime });
}
