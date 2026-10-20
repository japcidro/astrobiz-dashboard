import { createServiceClient } from "@/lib/supabase/service";
import { runTranscriptionBatch } from "@/lib/call-coach/transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 30 minutes: Gemini transcribes the Call Coach minutes that landed
// since the last run, oldest first, so the nightly review has little left to do.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await runTranscriptionBatch(createServiceClient(), { limit: 80, deadlineMs: 250_000, concurrency: 4 });
    return Response.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 500 });
  }
}
