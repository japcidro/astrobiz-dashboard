import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/employee-shifts/list?start=YYYY-MM-DD&end=YYYY-MM-DD&employee_id=...
// Admin sees all; non-admins see only their own shifts.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const employeeIdFilter = url.searchParams.get("employee_id");

  if (!start || !end) {
    return Response.json({ error: "start and end are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("employee_shifts")
    .select("*")
    .gte("shift_date", start)
    .lte("shift_date", end)
    .order("shift_date", { ascending: true });

  if (employee.role !== "admin") {
    query = query.eq("employee_id", employee.id);
  } else if (employeeIdFilter) {
    query = query.eq("employee_id", employeeIdFilter);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Admin also needs the employee list for the grid
  let employees: Array<{ id: string; full_name: string; role: string; email: string }> = [];
  if (employee.role === "admin") {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, full_name, role, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    employees = emps ?? [];
  }

  return Response.json({ shifts: data ?? [], employees });
}
