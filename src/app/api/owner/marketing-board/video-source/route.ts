import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { VideoSource } from "@/lib/marketing-board/types";
import { resolveAdVideo } from "@/lib/facebook/video";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * GET ?fb_ad_id=&video_id=&account_id=  — a playable URL for a submitted
 * ad's video, resolved from Facebook on open (the CDN URLs expire). Same
 * approach as the Submitted Videos screen; the token never leaves the server.
 */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("video_id");
  const fbAdId = searchParams.get("fb_ad_id");
  const accountId = searchParams.get("account_id") || undefined;
  if (!videoId && !fbAdId) return Response.json({ error: "Missing video_id or fb_ad_id" }, { status: 400 });

  const { data: tokenSetting } = await auth.db.from("app_settings").select("value").eq("key", "fb_access_token").maybeSingle();
  const token = tokenSetting?.value as string | undefined;
  if (!token) return Response.json({ error: "Facebook token not configured. Go to Settings." }, { status: 400 });

  // Fast path: the uploaded video node, which exposes `source`.
  if (videoId) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/${videoId}?fields=source,picture,permalink_url&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { source?: string; picture?: string; permalink_url?: string };
      if (res.ok && json.source) {
        const permalink = json.permalink_url
          ? json.permalink_url.startsWith("http") ? json.permalink_url : `https://www.facebook.com${json.permalink_url}`
          : null;
        const out: VideoSource = { source: json.source, thumbnail: json.picture ?? null, permalink };
        return Response.json(out);
      }
    } catch {
      // fall through to the ad walk
    }
  }

  if (!fbAdId) return Response.json({ error: "Facebook returned no playable video" }, { status: 404 });
  const v = await resolveAdVideo(fbAdId, token, accountId);
  if (!v.video_url) {
    return Response.json({ error: v.source_note || "No playable video found for this ad" }, { status: 404 });
  }
  const out: VideoSource = { source: v.video_url, thumbnail: v.thumbnail_url, permalink: null };
  return Response.json(out);
}
