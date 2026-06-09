import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { SubmittedVideoSource } from "@/lib/marketing/submitted-videos";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Resolves a playable video URL on-demand for one Facebook video_id.
//
// The video file lives on Facebook — we keep no copy. Here we exchange the
// video_id for a fresh, temporary CDN URL via the Graph API. The FB token
// never leaves the server. Images are displayed directly from the creative's
// inline image_url (no call needed), so this endpoint only handles video.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("video_id");
  if (!videoId) {
    return Response.json({ error: "Missing video_id" }, { status: 400 });
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
      source: (json?.source as string) ?? null,
      thumbnail: (json?.picture as string) ?? null,
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
