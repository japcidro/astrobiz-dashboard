import { getEmployee } from "@/lib/supabase/get-employee";
import { getPageToken } from "@/lib/facebook/page-token";

export const dynamic = "force-dynamic";

/**
 * Returns a Facebook PAGE access token for the given page (admin-only).
 * The browser uses it to publish an organic post directly to Facebook,
 * which avoids routing media bytes through the serverless body-size limit.
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

  const token = await getPageToken(pageId);
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  return Response.json({ token });
}
