import { getEmployee } from "@/lib/supabase/get-employee";
import { getPageToken } from "@/lib/facebook/page-token";
import { fbGet, fbPost } from "@/lib/fb-ads-module/fb-api";

export const dynamic = "force-dynamic";

// Facebook scheduling window: at least 10 minutes, at most ~6 months ahead.
const MIN_SCHEDULE_SECONDS = 10 * 60;
const MAX_SCHEDULE_SECONDS = 60 * 60 * 24 * 30 * 6;

async function requireAdmin(): Promise<{ error: string; status: number } | null> {
  const employee = await getEmployee();
  if (!employee) return { error: "Unauthorized", status: 401 };
  if (employee.role !== "admin") return { error: "Forbidden", status: 403 };
  return null;
}

/** GET — list the scheduled (unpublished, future) posts for a page. */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const pageId = new URL(request.url).searchParams.get("pageId")?.trim() || "";
  if (!pageId) return Response.json({ error: "Missing pageId" }, { status: 400 });

  const token = await getPageToken(pageId);
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  try {
    const json = await fbGet(`/${pageId}/scheduled_posts`, token, {
      fields:
        "id,message,scheduled_publish_time,created_time,permalink_url,attachments{media_type,type,url,media,title}",
      limit: "100",
    });
    return Response.json({ data: (json.data as unknown[]) || [] });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load scheduled posts" },
      { status: 500 }
    );
  }
}

/**
 * PATCH — edit a scheduled post's text, reschedule it, or publish it now.
 * Body: { pageId, postId, message?, scheduledPublishTime?, publishNow? }
 */
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const body = (await request.json().catch(() => null)) as {
    pageId?: string;
    postId?: string;
    message?: string;
    scheduledPublishTime?: number;
    publishNow?: boolean;
  } | null;

  const pageId = body?.pageId?.trim();
  const postId = body?.postId?.trim();
  if (!pageId || !postId) {
    return Response.json({ error: "Missing pageId or postId" }, { status: 400 });
  }

  const token = await getPageToken(pageId);
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  const params: Record<string, string> = {};
  if (typeof body?.message === "string") params.message = body.message;

  if (body?.publishNow) {
    // Publishing immediately drops the scheduled time.
    params.is_published = "true";
  } else if (typeof body?.scheduledPublishTime === "number") {
    const now = Math.floor(Date.now() / 1000);
    const ts = Math.floor(body.scheduledPublishTime);
    if (ts < now + MIN_SCHEDULE_SECONDS) {
      return Response.json(
        { error: "Schedule must be at least 10 minutes ahead." },
        { status: 400 }
      );
    }
    if (ts > now + MAX_SCHEDULE_SECONDS) {
      return Response.json({ error: "Schedule must be within 6 months." }, { status: 400 });
    }
    params.scheduled_publish_time = String(ts);
  }

  if (Object.keys(params).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await fbPost(`/${postId}`, token, params);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}

/** DELETE — remove a scheduled post. Query: ?pageId=&postId= */
export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId")?.trim() || "";
  const postId = url.searchParams.get("postId")?.trim() || "";
  if (!pageId || !postId) {
    return Response.json({ error: "Missing pageId or postId" }, { status: 400 });
  }

  const token = await getPageToken(pageId);
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  try {
    // Graph API honors a `method=delete` override on a POST body.
    await fbPost(`/${postId}`, token, { method: "delete" });
    return Response.json({ success: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}
