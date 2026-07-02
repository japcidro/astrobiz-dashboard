import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fbGet } from "@/lib/fb-ads-module/fb-api";

export const dynamic = "force-dynamic";

/**
 * Returns a Facebook PAGE access token for the given page (admin-only).
 * The browser uses it to publish an organic post directly to Facebook,
 * which avoids routing image bytes through the serverless body-size limit.
 */
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const pageId = new URL(request.url).searchParams.get("pageId")?.trim() || "";
  if (!pageId) {
    return Response.json({ error: "Missing pageId" }, { status: 400 });
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

  // Derive a page token from the system-user token (works when the system user
  // is assigned to the page). Fall back to the system token itself.
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

  return Response.json({ token: pageToken });
}
