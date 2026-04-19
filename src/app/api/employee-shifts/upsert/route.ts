import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST body: { employee_id, shift_date, start_time?, end_time?, break_minutes?, is_off_day? }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    employee_id?: string;
    shift_date?: string;
    start_time?: string | null;
    end_time?: string | null;
    break_minutes?: number;
    is_off_day?: boolean;
  };

  if (!body.employee_id || !body.shift_date) {
    return Response.json(
      { error: "employee_id and shift_date are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const row = {
    employee_id: body.employee_id,
    shift_date: body.shift_date,
    start_time: body.is_off_day ? null : body.start_time ?? null,
    end_time: body.is_off_day ? null : body.end_time ?? null,
    break_minutes: body.break_minutes ?? 60,
    is_off_day: body.is_off_day ?? false,
    created_by: employee.id,
  };

  const { data, error } = await supabase
    .from("employee_shifts")
    .upsert(row, { onConflict: "employee_id,shift_date" })
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ shift: data });
}
