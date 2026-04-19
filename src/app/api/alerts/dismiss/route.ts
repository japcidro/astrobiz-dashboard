import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST body: { id: string }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("admin_alerts")
    .update({ dismissed_at: now, read_at: now })
    .eq("id", body.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
