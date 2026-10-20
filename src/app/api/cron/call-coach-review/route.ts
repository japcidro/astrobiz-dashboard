import { createServiceClient } from "@/lib/supabase/service";
import { runTranscriptionBatch } from "@/lib/call-coach/transcribe";
import { employeesNeedingReview, reviewDay } from "@/lib/call-coach/review";
import { phDate } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 11:30 PM Manila: finish any transcription still pending, then Claude
// reviews every VA whose day has minutes a done review does not cover yet.
// Yesterday is included so a late shift or a failed run gets a second pass.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createServiceClient();
  const started = Date.now();
  const transcription = await runTranscriptionBatch(db, { limit: 60, deadlineMs: 90_000, concurrency: 4 }).catch((e) => ({
    processed: 0,
    failed: 0,
    skipped: e instanceof Error ? e.message : "Transcription failed",
  }));

  const today = phDate();
  const yesterday = phDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const results: Array<{ employee_id: string; date: string; status: string; reason?: string }> = [];
  for (const date of [yesterday, today]) {
    for (const employeeId of await employeesNeedingReview(db, date)) {
      if (Date.now() - started > 270_000) break;
      const r = await reviewDay(db, employeeId, date);
      results.push({ employee_id: employeeId, date, status: r.status, reason: r.reason });
    }
  }
  return Response.json({ ok: true, transcription, reviews: results, ms: Date.now() - started });
}
