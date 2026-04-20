import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Admin-only tracer that probes every FB Graph path used by the video
// resolver and returns the raw responses (redacted). Point of this is
// diagnosing "no playable MP4" errors when the user-facing error alone
// isn't enough.
//
// Usage: /api/admin/video-trace?ad_id=1234567890[&account_id=act_XXX]

const FB_API_BASE = "https://graph.facebook.com/v21.0";

type Json = Record<string, unknown>;

function redactToken(value: unknown): unknown {
  if (typeof value === "string" && value.length > 20) {
    return `${value.slice(0, 8)}…${value.slice(-4)} (len=${value.length})`;
  }
  return value;
}

async function fbGet(
  path: string,
  token: string
): Promise<{ status: number; body: Json | string }> {
  const sep = path.includes("?") ? "&" : "?";
  try {
    const res = await fetch(
      `${FB_API_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as Json };
    } catch {
      return { status: res.status, body: text.slice(0, 500) };
    }
  } catch (err) {
    return {
      status: 0,
      body: `fetch threw: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("ad_id");
  let accountId = searchParams.get("account_id") ?? "";
  if (!adId) {
    return Response.json({ error: "ad_id required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json({ error: "fb_access_token not set" }, { status: 400 });
  }

  const trace: Array<{ step: string; status: number; body: unknown }> = [];

  // Step 0: what does the token belong to?
  trace.push({
    step: "token metadata (/debug_token)",
    ...(await fbGet(
      `/debug_token?input_token=${encodeURIComponent(token)}`,
      token
    )),
  });

  // Step 1: creative fetch.
  const creativeRes = await fbGet(
    `/${adId}?fields=account_id,creative{id,video_id,thumbnail_url,effective_object_story_id,object_type,asset_feed_spec,object_story_spec}`,
    token
  );
  trace.push({ step: "ad → creative", ...creativeRes });

  const creativeBody = creativeRes.body as Json;
  if (!accountId) {
    accountId =
      typeof creativeBody?.account_id === "string"
        ? `act_${creativeBody.account_id}`
        : "";
  }

  const creative =
    typeof creativeBody?.creative === "object" && creativeBody.creative !== null
      ? (creativeBody.creative as Json)
      : {};
  const storyId =
    typeof creative?.effective_object_story_id === "string"
      ? (creative.effective_object_story_id as string)
      : null;

  // Pick the video_id the same way the resolver does.
  let videoId: string | null = null;
  const oss = creative?.object_story_spec as Json | undefined;
  const vd = oss?.video_data as Json | undefined;
  const ld = oss?.link_data as Json | undefined;
  const afs = creative?.asset_feed_spec as Json | undefined;

  if (typeof creative?.video_id === "string") {
    videoId = creative.video_id as string;
  } else if (typeof vd?.video_id === "string") {
    videoId = vd.video_id as string;
  } else if (typeof ld?.video_id === "string") {
    videoId = ld.video_id as string;
  } else if (Array.isArray(afs?.videos) && afs.videos.length > 0) {
    const v = (afs.videos as Json[])[0];
    if (typeof v?.video_id === "string") videoId = v.video_id as string;
  }

  trace.push({
    step: "video_id pick",
    status: 200,
    body: { video_id: videoId, story_id: storyId, account_id: accountId },
  });

  if (!videoId) {
    return Response.json({
      ad_id: adId,
      verdict: "stopped — no video_id on creative",
      trace,
    });
  }

  // Step 2: direct video lookup with SU token.
  trace.push({
    step: "video?fields=source,muted_video_url,permissions,permalink_url,from,status",
    ...(await fbGet(
      `/${videoId}?fields=source,muted_video_url,permissions,permalink_url,from,status`,
      token
    )),
  });

  // Step 3: page token hop.
  const pageIdFromStory = storyId ? storyId.split("_")[0] : null;
  if (pageIdFromStory) {
    const pageTokenCall = await fbGet(
      `/${pageIdFromStory}?fields=id,name,access_token,tasks`,
      token
    );
    // Do not leak the page token — redact it before returning.
    if (
      typeof pageTokenCall.body === "object" &&
      pageTokenCall.body !== null &&
      typeof (pageTokenCall.body as Json).access_token === "string"
    ) {
      (pageTokenCall.body as Json).access_token = redactToken(
        (pageTokenCall.body as Json).access_token
      );
    }
    trace.push({
      step: `page token (story-derived page=${pageIdFromStory})`,
      ...pageTokenCall,
    });

    // If we got a token, retry the video source with it.
    const pageTokenRaw = await fbGet(
      `/${pageIdFromStory}?fields=access_token`,
      token
    );
    const pageTokenValue =
      typeof pageTokenRaw.body === "object" &&
      pageTokenRaw.body !== null &&
      typeof (pageTokenRaw.body as Json).access_token === "string"
        ? ((pageTokenRaw.body as Json).access_token as string)
        : null;
    if (pageTokenValue) {
      trace.push({
        step: "video?fields=source (with PAGE token)",
        ...(await fbGet(
          `/${videoId}?fields=source,muted_video_url,permalink_url`,
          pageTokenValue
        )),
      });
    } else {
      trace.push({
        step: "skip page-token retry",
        status: 0,
        body: "no page token obtained",
      });
    }
  } else {
    trace.push({
      step: "skip page token hop",
      status: 0,
      body: "no page_id derivable from effective_object_story_id",
    });
  }

  // Step 4: advideos edge on the ad account.
  if (accountId) {
    const filtering = encodeURIComponent(
      JSON.stringify([{ field: "id", operator: "IN", value: [videoId] }])
    );
    trace.push({
      step: `advideos edge on ${accountId}`,
      ...(await fbGet(
        `/${accountId}/advideos?fields=source,from&filtering=${filtering}&limit=1`,
        token
      )),
    });
  }

  return Response.json({
    ad_id: adId,
    video_id: videoId,
    story_id: storyId,
    account_id: accountId || "(not provided)",
    trace,
  });
}
