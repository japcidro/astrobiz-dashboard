import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST body: { id }  OR  { employee_id, shift_date }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    employee_id?: string;
    shift_date?: string;
  };

  const supabase = await createClient();
  let query = supabase.from("employee_shifts").delete();
  if (body.id) {
    query = query.eq("id", body.id);
  } else if (body.employee_id && body.shift_date) {
    query = query.eq("employee_id", body.employee_id).eq("shift_date", body.shift_date);
  } else {
    return Response.json({ error: "id OR (employee_id + shift_date) required" }, { status: 400 });
  }
  const { error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
