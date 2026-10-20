import { createServiceClient } from "@/lib/supabase/service";
import { CALL_COACH_BUCKET, RETENTION_DAYS } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Deletes Call Coach audio older than the retention window, file first, then
// the row. Mic events go after 90 days. Runs daily; each run clears up to 500
// segments, which is more than two VAs record in a week.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: old, error } = await db
    .from("call_coach_segments")
    .select("id, storage_path")
    .lt("started_at", cutoff)
    .order("started_at")
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let removedFiles = 0;
  let removedRows = 0;
  const rows = old ?? [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: rmError } = await db.storage.from(CALL_COACH_BUCKET).remove(batch.map((r) => r.storage_path as string));
    if (rmError) return Response.json({ error: `Storage: ${rmError.message}`, removedFiles, removedRows }, { status: 500 });
    removedFiles += batch.length;
    const { error: delError } = await db
      .from("call_coach_segments")
      .delete()
      .in("id", batch.map((r) => r.id as string));
    if (delError) return Response.json({ error: delError.message, removedFiles, removedRows }, { status: 500 });
    removedRows += batch.length;
  }

  const eventCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await db.from("call_coach_mic_events").delete().lt("at", eventCutoff);

  return Response.json({ ok: true, cutoff, removedFiles, removedRows });
}
