import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveAdVideo } from "@/lib/facebook/video";
import type { SubmittedVideoSource } from "@/lib/marketing/submitted-videos";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Resolves a playable video URL on-demand.
//
// Accepts either ?video_id= (fast path, used by the Submitted Videos grid
// which already knows the video id) or ?fb_ad_id=&account_id= (used by Ad
// Performance, where rows carry only the ad id). The FB token never leaves
// the server. Images are shown from the creative's inline image_url, so this
// endpoint only handles video.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  let videoId = searchParams.get("video_id");
  const fbAdId = searchParams.get("fb_ad_id");
  const accountId = searchParams.get("account_id") || undefined;
  if (!videoId && !fbAdId) {
    return Response.json({ error: "Missing video_id or fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;

  // No video_id yet (Ad Performance) → resolve the ad's video from FB.
  let fallbackUrl: string | null = null;
  let fallbackThumb: string | null = null;
  if (!videoId && fbAdId) {
    try {
      const v = await resolveAdVideo(fbAdId, token, accountId);
      videoId = v.video_id;
      fallbackUrl = v.video_url;
      fallbackThumb = v.thumbnail_url;
    } catch {
      // fall through — handled below
    }
    if (!videoId && !fallbackUrl) {
      return Response.json(
        { error: "No playable video found for this ad" },
        { status: 404 }
      );
    }
    // Resolved a direct playable URL but no video_id node — return it as-is.
    if (!videoId && fallbackUrl) {
      const result: SubmittedVideoSource = {
        source: fallbackUrl,
        thumbnail: fallbackThumb,
        permalink: null,
        status: "ready",
        length: null,
      };
      return Response.json({ data: result });
    }
  }

  try {
    const res = await fetch(
      `${FB_API_BASE}/${videoId}?fields=source,picture,permalink_url,length,status&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    if (!res.ok) {
      const msg =
        (json?.error?.error_user_msg as string) ||
        (json?.error?.message as string) ||
        `Facebook error ${res.status}`;
      return Response.json({ error: msg }, { status: 502 });
    }

    const statusObj = json?.status as Record<string, unknown> | undefined;
    const videoStatus =
      (statusObj?.video_status as string) ||
      (typeof json?.status === "string" ? (json.status as string) : null);

    // FB returns permalink_url as a site-relative path — make it absolute.
    const rawPermalink = (json?.permalink_url as string) ?? null;
    const permalink = rawPermalink
      ? rawPermalink.startsWith("http")
        ? rawPermalink
        : `https://www.facebook.com${rawPermalink}`
      : null;

    const result: SubmittedVideoSource = {
      source: (json?.source as string) ?? fallbackUrl,
      thumbnail: (json?.picture as string) ?? fallbackThumb,
      permalink,
      status: videoStatus,
      length: typeof json?.length === "number" ? json.length : null,
    };
    return Response.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to resolve media";
    return Response.json({ error: message }, { status: 500 });
  }
}
