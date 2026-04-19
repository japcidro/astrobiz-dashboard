import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "unread";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);

  const supabase = await createClient();
  let query = supabase
    .from("employee_notifications")
    .select("*")
    .eq("employee_id", employee.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "unread") {
    query = query.is("read_at", null).is("dismissed_at", null);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { count: unreadTotal } = await supabase
    .from("employee_notifications")
    .select("*", { count: "exact", head: true })
    .eq("employee_id", employee.id)
    .is("read_at", null)
    .is("dismissed_at", null);

  return Response.json({
    notifications: data ?? [],
    unread_total: unreadTotal ?? 0,
  });
}
