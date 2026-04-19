import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/alerts/list?status=unread|all&limit=50
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "unread";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  const supabase = await createClient();
  let query = supabase
    .from("admin_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "unread") {
    query = query.is("read_at", null).is("dismissed_at", null);
  } else if (status === "dismissed") {
    query = query.not("dismissed_at", "is", null);
  } else if (status === "acted") {
    query = query.not("acted_on_at", "is", null);
  }
  // "all" applies no filter

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Also return the unread-urgent count for badge display
  const { count: urgentUnread } = await supabase
    .from("admin_alerts")
    .select("*", { count: "exact", head: true })
    .is("read_at", null)
    .is("dismissed_at", null)
    .eq("severity", "urgent");

  const { count: totalUnread } = await supabase
    .from("admin_alerts")
    .select("*", { count: "exact", head: true })
    .is("read_at", null)
    .is("dismissed_at", null);

  return Response.json({
    alerts: data ?? [],
    unread_total: totalUnread ?? 0,
    unread_urgent: urgentUnread ?? 0,
  });
}
