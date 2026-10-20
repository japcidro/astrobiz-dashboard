import { requireCoach } from "@/lib/call-coach/server";
import { runTranscriptionBatch } from "@/lib/call-coach/transcribe";
import { reviewDay } from "@/lib/call-coach/review";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { employee_id, date } — "Review now" on the owner page: transcribe
 * whatever is still pending for that VA's day, then run (or re-run) Claude.
 */
export async function POST(request: Request) {
  const auth = await requireCoach();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as { employee_id?: string; date?: string } | null;
  const employeeId = body?.employee_id ?? "";
  const date = body?.date ?? "";
  if (!/^[0-9a-f-]{36}$/.test(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Pick an employee and a date" }, { status: 400 });
  }

  const transcription = await runTranscriptionBatch(auth.db, {
    limit: 120,
    deadlineMs: 150_000,
    concurrency: 4,
    filter: { employeeId, date },
  }).catch((e) => ({ processed: 0, failed: 0, skipped: e instanceof Error ? e.message : "Transcription failed" }));

  const result = await reviewDay(auth.db, employeeId, date, { force: true });
  if (result.status === "failed") return Response.json({ error: result.reason, transcription }, { status: 500 });
  return Response.json({ ...result, transcription });
}
