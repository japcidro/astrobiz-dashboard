import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fbPost, fbGet } from "@/lib/fb-ads-module/fb-api";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Publish a single organic post to a Facebook Page.
 * Admin-only. Supports text (+ optional link) or a photo (+ caption).
 */
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
  const systemToken = tokenSetting.value as string;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const pageId = (form.get("pageId") as string | null)?.trim() || "";
  const message = (form.get("message") as string | null)?.trim() || "";
  const link = (form.get("link") as string | null)?.trim() || "";
  const image = form.get("image");
  const hasImage = image instanceof File && image.size > 0;

  if (!pageId) {
    return Response.json({ error: "Select a Facebook Page" }, { status: 400 });
  }
  if (!message && !hasImage) {
    return Response.json(
      { error: "Add a message or an image to post" },
      { status: 400 }
    );
  }

  try {
    // A Page post needs a PAGE access token. Derive it from the system token
    // (works when the system user is assigned to the page). Fall back to the
    // system token itself if the page token can't be fetched.
    let pageToken = systemToken;
    try {
      const pageInfo = await fbGet(`/${pageId}`, systemToken, {
        fields: "access_token",
      });
      if (typeof pageInfo.access_token === "string" && pageInfo.access_token) {
        pageToken = pageInfo.access_token;
      }
    } catch {
      // keep systemToken fallback
    }

    let result: Record<string, unknown>;

    if (hasImage) {
      // Photo post — multipart (fbPost is urlencoded, so build FormData inline).
      const fbForm = new FormData();
      fbForm.append("access_token", pageToken);
      fbForm.append("source", image as File);
      if (message) fbForm.append("caption", message);
      const res = await fetch(`${FB_API_BASE}/${pageId}/photos`, {
        method: "POST",
        body: fbForm,
      });
      const json = await res.json();
      if (!res.ok) {
        const fbErr = json.error as Record<string, unknown> | undefined;
        const msg =
          (fbErr?.error_user_msg as string) ||
          (fbErr?.message as string) ||
          `Photo post failed: ${res.status}`;
        throw new Error(msg);
      }
      result = json;
    } else {
      // Text (+ optional link) post to the page feed.
      result = await fbPost(`/${pageId}/feed`, pageToken, {
        message,
        ...(link ? { link } : {}),
      });
    }

    // photos returns { id, post_id }; feed returns { id }
    const postId = (result.post_id as string) || (result.id as string) || "";
    const permalink = postId ? `https://www.facebook.com/${postId}` : null;

    return Response.json({ id: postId, permalink });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to publish post";
    return Response.json({ error: message }, { status: 500 });
  }
}
