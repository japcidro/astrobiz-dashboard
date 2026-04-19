import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";

export const dynamic = "force-dynamic";
// Video download + Gemini analysis can take a while. Keep under 60s (Vercel default).
export const maxDuration = 60;

// Re-analyze only if the existing row is older than this.
const STALE_AFTER_DAYS = 7;

async function getApiKeys(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ fb: string | null; gemini: string | null }> {
  const [fbRes, geminiRes] = await Promise.all([
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
  return {
    fb: (fbRes.data?.value as string | undefined) ?? null,
    gemini: (geminiRes.data?.value as string | undefined) ?? null,
  };
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_id?: string;
    account_id?: string;
    force_refresh?: boolean;
    trigger_source?: "on_demand" | "auto_daily";
  };

  const adId = (body.ad_id ?? "").toString();
  const accountId = (body.account_id ?? "").toString();
  if (!adId || !accountId) {
    return Response.json(
      { error: "ad_id and account_id are required" },
      { status: 400 }
    );
  }

  const triggerSource = body.trigger_source === "auto_daily"
    ? "auto_daily"
    : "on_demand";

  const supabase = await createClient();

  // Return cached if fresh and not forced.
  if (!body.force_refresh) {
    const { data: cached } = await supabase
      .from("ad_creative_analyses")
      .select("*")
      .eq("ad_id", adId)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.created_at).getTime();
      const stale = ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
      if (!stale) {
        return Response.json({ cached: true, row: cached });
      }
    }
  }

  const { fb, gemini } = await getApiKeys(supabase);
  if (!fb) {
    return Response.json(
      { error: "Facebook token not configured. Go to Admin → Settings." },
      { status: 400 }
    );
  }
  if (!gemini) {
    return Response.json(
      { error: "Gemini API key not configured. Go to Admin → Settings." },
      { status: 400 }
    );
  }

  // 1. Resolve the video URL from the ad
  let videoRef;
  try {
    videoRef = await resolveAdVideo(adId, fb);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[deconstruct] resolveAdVideo failed:", msg);
    return Response.json(
      { error: `Could not read ad creative from Facebook: ${msg}` },
      { status: 502 }
    );
  }

  if (!videoRef.video_url) {
    return Response.json(
      {
        error: "No playable video on this ad.",
        detail: videoRef.source_note,
        ad_id: adId,
      },
      { status: 422 }
    );
  }

  // 2. Call Gemini
  let result;
  try {
    result = await deconstructAdVideo(videoRef.video_url, gemini);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(
      `[deconstruct] Gemini failed ad=${adId} size=${videoRef.video_id}:`,
      msg
    );
    return Response.json(
      { error: `Video analysis failed: ${msg}` },
      { status: 502 }
    );
  }

  // 3. Upsert into cache. The UNIQUE index on ad_id means re-running
  //    (force_refresh or stale) replaces the old row.
  const row = {
    ad_id: adId,
    account_id: accountId,
    creative_id: videoRef.creative_id,
    video_id: videoRef.video_id,
    video_url: null, // expires — do not persist
    thumbnail_url: videoRef.thumbnail_url,
    analysis: result.analysis as unknown as Record<string, unknown>,
    analyzed_by: employee.id,
    trigger_source: triggerSource,
    model: result.model,
    tokens_used: result.tokens_used,
    cost_usd: null as number | null,
  };

  const { data: saved, error: upsertError } = await supabase
    .from("ad_creative_analyses")
    .upsert(row, { onConflict: "ad_id" })
    .select("*")
    .single();

  if (upsertError) {
    console.error("[deconstruct] upsert failed:", upsertError);
    return Response.json(
      { error: upsertError.message, code: upsertError.code },
      { status: 500 }
    );
  }

  console.info(
    `[deconstruct] ad=${adId} trigger=${triggerSource} size=${(result.size_bytes / 1024 / 1024).toFixed(1)}MB tokens=${result.tokens_used ?? "?"}`
  );

  return Response.json({ cached: false, row: saved });
}
