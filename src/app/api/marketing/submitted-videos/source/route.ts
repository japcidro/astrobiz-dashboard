import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { SubmittedVideoSource } from "@/lib/marketing/submitted-videos";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Resolves a playable media URL for one submitted ad, on-demand.
//
// The video file itself is never stored by us — it lives on Facebook. We
// keep only the video_id (inside ad_drafts.ad_data). Here we exchange that
// id for a fresh, temporary CDN URL via the Graph API. The FB token never
// leaves the server. Images resolve via the ad account's image hash.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = await createClient();

  // Load the submission. Marketers can only resolve their own.
  let draftQuery = supabase
    .from("ad_drafts")
    .select("ad_data, ad_account_id, employee_id")
    .eq("id", id)
    .eq("status", "submitted");
  if (employee.role === "marketing") {
    draftQuery = draftQuery.eq("employee_id", employee.id);
  }
  const { data: draft, error: draftErr } = await draftQuery.single();

  if (draftErr || !draft) {
    return Response.json({ error: "Submission not found" }, { status: 404 });
  }

  const ad = (draft.ad_data ?? {}) as Record<string, unknown>;
  const videoId = (ad.video_id as string | null) ?? null;
  const imageHash = (ad.image_hash as string | null) ?? null;
  const adAccountId = draft.ad_account_id as string;

  // FB token (same source the create + token routes use).
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;

  const empty: SubmittedVideoSource = {
    source: null,
    thumbnail: null,
    permalink: null,
    status: null,
    length: null,
  };

  try {
    if (videoId) {
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
    }

    if (imageHash && adAccountId) {
      const res = await fetch(
        `${FB_API_BASE}/${adAccountId}/adimages?hashes=${encodeURIComponent(
          JSON.stringify([imageHash])
        )}&fields=url,permalink_url&access_token=${encodeURIComponent(token)}`
      );
      const json = await res.json();
      if (!res.ok) {
        const msg =
          (json?.error?.error_user_msg as string) ||
          (json?.error?.message as string) ||
          `Facebook error ${res.status}`;
        return Response.json({ error: msg }, { status: 502 });
      }
      const img = (json?.data as Array<Record<string, unknown>> | undefined)?.[0];
      const result: SubmittedVideoSource = {
        source: (img?.url as string) ?? null,
        thumbnail: (img?.url as string) ?? null,
        permalink: (img?.permalink_url as string) ?? null,
        status: "ready",
        length: null,
      };
      return Response.json({ data: result });
    }

    // Nothing resolvable (shouldn't happen for a real submission).
    return Response.json({ data: empty });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to resolve media";
    return Response.json({ error: message }, { status: 500 });
  }
}
