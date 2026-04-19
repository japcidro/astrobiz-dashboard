import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST body: { ids?: string[], all?: boolean }
// - ids: mark specific alerts as read
// - all: mark every unread alert as read (used by the inbox "mark all" button)
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    all?: boolean;
  };
  const supabase = await createClient();
  const now = new Date().toISOString();

  let query = supabase.from("admin_alerts").update({ read_at: now });
  if (body.all) {
    query = query.is("read_at", null);
  } else if (body.ids && body.ids.length > 0) {
    query = query.in("id", body.ids);
  } else {
    return Response.json({ error: "Provide ids or all=true" }, { status: 400 });
  }

  const { data, error } = await query.select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, updated: (data ?? []).length });
}
