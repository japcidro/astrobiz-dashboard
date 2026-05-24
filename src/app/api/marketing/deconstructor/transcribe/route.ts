import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";

export const dynamic = "force-dynamic";
// One Gemini run on a ~200MB video can take ~3 minutes; keep the
// full 300s budget for a single-ad on-demand call.
export const maxDuration = 300;

// POST /api/marketing/deconstructor/transcribe
// body: { ad_id: string, account_id?: string }
//
// On-demand Gemini transcription for ONE ad. Same pipeline as the
// /api/cron/deconstruct-top-ads daily job, but triggered manually
// from the ILP Deconstruction modal when an ad isn't in the cron
// yet (new ad, under-spent, missed the top-N cutoff).
//
// Upserts the result into ad_creative_analyses so the from-analysis
// endpoint can pick it up on the immediate next call.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { ad_id, account_id } = body as {
    ad_id?: string;
    account_id?: string;
  };
  if (!ad_id) {
    return Response.json({ error: "ad_id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Credentials
  const [{ data: fbTokenRow }, { data: geminiKeyRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "gemini_api_key")
      .single(),
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

  // 1. Resolve the FB video for this ad.
  let video;
  try {
    video = await resolveAdVideo(ad_id, fbToken, account_id);
  } catch (err) {
    return Response.json(
      {
        error: `FB video lookup failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 }
    );
  }

  if (!video.video_url) {
    return Response.json(
      {
        error: `No video found for this ad. ${video.source_note || ""}`.trim(),
        attempts: video.attempts,
      },
      { status: 404 }
    );
  }

  // 2. Run Gemini on the video.
  let out;
  try {
    out = await deconstructAdVideo(video.video_url, geminiKey);
  } catch (err) {
    return Response.json(
      {
        error: `Gemini analysis failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 }
    );
  }

  // 3. Upsert into ad_creative_analyses so from-analysis picks it up.
  const { error: upsertErr } = await supabase
    .from("ad_creative_analyses")
    .upsert(
      {
        ad_id,
        account_id: account_id ?? null,
        creative_id: video.creative_id,
        video_id: video.video_id,
        video_url: null,
        thumbnail_url: video.thumbnail_url,
        analysis: out.analysis as unknown as Record<string, unknown>,
        analyzed_by: employee.id,
        // 'on_demand' is the existing whitelisted value for user-initiated
        // calls (see ad_creative_analyses_trigger_chk check constraint).
        trigger_source: "on_demand",
        model: out.model,
        tokens_used: out.tokens_used,
        cost_usd: null,
      },
      { onConflict: "ad_id" }
    );

  if (upsertErr) {
    return Response.json(
      { error: `Failed to save analysis: ${upsertErr.message}` },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    ad_id,
    has_transcript: !!out.analysis?.transcript,
    model: out.model,
    tokens_used: out.tokens_used,
  });
}
