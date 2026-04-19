import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST body: { source_start: "YYYY-MM-DD", source_end: "YYYY-MM-DD", target_start: "YYYY-MM-DD" }
// Copies all shifts in [source_start, source_end] to starting from target_start (same day-of-week order).
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_start?: string;
    source_end?: string;
    target_start?: string;
  };
  if (!body.source_start || !body.source_end || !body.target_start) {
    return Response.json({ error: "source_start, source_end, target_start required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: sourceShifts } = await supabase
    .from("employee_shifts")
    .select("*")
    .gte("shift_date", body.source_start)
    .lte("shift_date", body.source_end);

  if (!sourceShifts || sourceShifts.length === 0) {
    return Response.json({ copied: 0 });
  }

  const sourceStart = new Date(body.source_start + "T00:00:00Z");
  const targetStart = new Date(body.target_start + "T00:00:00Z");
  const offsetMs = targetStart.getTime() - sourceStart.getTime();

  const targetShifts = sourceShifts.map((s) => {
    const sDate = new Date(s.shift_date + "T00:00:00Z");
    const tDate = new Date(sDate.getTime() + offsetMs);
    const targetDate = tDate.toISOString().slice(0, 10);
    return {
      employee_id: s.employee_id,
      shift_date: targetDate,
      start_time: s.start_time,
      end_time: s.end_time,
      break_minutes: s.break_minutes,
      is_off_day: s.is_off_day,
      created_by: employee.id,
    };
  });

  const { error } = await supabase
    .from("employee_shifts")
    .upsert(targetShifts, { onConflict: "employee_id,shift_date" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ copied: targetShifts.length });
}
