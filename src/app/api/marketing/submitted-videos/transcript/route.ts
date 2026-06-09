import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveAdVideo } from "@/lib/facebook/video";
import { transcribeAdVideo } from "@/lib/gemini/deconstruct";

export const dynamic = "force-dynamic";
// A single Gemini run on a large video can take a couple of minutes.
export const maxDuration = 300;

// GET ?fb_ad_id=...  → returns the cached transcript (no AI call), or null.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fbAdId = searchParams.get("fb_ad_id");
  if (!fbAdId) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("fb_ad_transcripts")
    .select("transcript, model, created_at")
    .eq("fb_ad_id", fbAdId)
    .maybeSingle();

  return Response.json({
    data: data
      ? { transcript: data.transcript, cached: true, created_at: data.created_at }
      : null,
  });
}

// POST { fb_ad_id, account_id? } → returns the transcript, generating it via
// Gemini (transcript-only, no analysis) and caching it if not already cached.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    fb_ad_id?: string;
    account_id?: string;
  };
  if (!body.fb_ad_id) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();

  // Cache hit → return immediately, no AI cost.
  const { data: cached } = await supabase
    .from("fb_ad_transcripts")
    .select("transcript")
    .eq("fb_ad_id", body.fb_ad_id)
    .maybeSingle();
  if (cached) {
    return Response.json({ data: { transcript: cached.transcript, cached: true } });
  }

  // Credentials.
  const [{ data: fbTokenRow }, { data: geminiKeyRow }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "fb_access_token").single(),
    supabase.from("app_settings").select("value").eq("key", "gemini_api_key").single(),
  ]);
  const fbToken = (fbTokenRow?.value as string | undefined) ?? null;
  const geminiKey = (geminiKeyRow?.value as string | undefined) ?? null;
  if (!fbToken) {
    return Response.json(
      { error: "Facebook token not configured. Go to Settings." },
      { status: 400 }
    );
  }
  if (!geminiKey) {
    return Response.json(
      { error: "Gemini API key not configured. Go to Settings." },
      { status: 400 }
    );
  }

  // Resolve the playable video for this ad.
  let video;
  try {
    video = await resolveAdVideo(body.fb_ad_id, fbToken, body.account_id);
  } catch (err) {
    return Response.json(
      { error: `Couldn't find the video: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }
  if (!video.video_url) {
    return Response.json(
      { error: `No playable video found for this ad. ${video.source_note || ""}`.trim() },
      { status: 404 }
    );
  }

  // Transcribe (Gemini, transcript-only).
  let result;
  try {
    result = await transcribeAdVideo(video.video_url, geminiKey);
  } catch (err) {
    return Response.json(
      { error: `Transcription failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }

  // Cache it (best-effort — a cache write failure shouldn't fail the response).
  await supabase.from("fb_ad_transcripts").upsert(
    {
      fb_ad_id: body.fb_ad_id,
      video_id: video.video_id,
      transcript: result.transcript,
      model: result.model,
      tokens_used: result.tokens_used,
      created_by: employee.id,
    },
    { onConflict: "fb_ad_id" }
  );

  return Response.json({
    data: { transcript: result.transcript, cached: false, model: result.model },
  });
}
