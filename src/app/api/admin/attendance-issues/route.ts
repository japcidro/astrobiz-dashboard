import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface IssueRow {
  type: "not_clocked_in" | "long_running" | "auto_closed_yesterday" | "missed_clockout";
  employee_id: string;
  employee_name: string;
  employee_role: string;
  detail: string;
  severity: "urgent" | "action" | "info";
}

function phtToday(now: Date = new Date()): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

function phtYesterday(now: Date = new Date()): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

function phtTimeNow(now: Date = new Date()): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const h = String(pht.getUTCHours()).padStart(2, "0");
  const m = String(pht.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const today = phtToday();
  const yesterday = phtYesterday();
  const currentTime = phtTimeNow();

  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, role")
    .eq("is_active", true);

  const { data: shiftsToday } = await supabase
    .from("employee_shifts")
    .select("*")
    .eq("shift_date", today);

  const { data: entriesToday } = await supabase
    .from("time_entries")
    .select("id, employee_id, status, started_at, ended_at, total_seconds")
    .eq("date", today);

  const { data: autoClosedYesterday } = await supabase
    .from("attendance_events")
    .select("employee_id, details, created_at")
    .eq("event_type", "auto_closed")
    .gte("created_at", `${yesterday}T00:00:00Z`)
    .lte("created_at", `${today}T00:00:00Z`);

  const shiftByEmp = new Map<string, { start_time: string | null; end_time: string | null; is_off_day: boolean }>();
  for (const s of (shiftsToday ?? []) as Array<{
    employee_id: string;
    start_time: string | null;
    end_time: string | null;
    is_off_day: boolean;
  }>) {
    shiftByEmp.set(s.employee_id, s);
  }

  const entriesByEmp = new Map<
    string,
    Array<{ id: string; status: string; started_at: string; ended_at: string | null; total_seconds: number }>
  >();
  for (const e of (entriesToday ?? []) as Array<{
    id: string;
    employee_id: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    total_seconds: number;
  }>) {
    const list = entriesByEmp.get(e.employee_id) ?? [];
    list.push(e);
    entriesByEmp.set(e.employee_id, list);
  }

  const issues: IssueRow[] = [];
  const nowMs = Date.now();

  for (const emp of (employees ?? []) as Array<{ id: string; full_name: string; role: string }>) {
    const shift = shiftByEmp.get(emp.id);
    const entries = entriesByEmp.get(emp.id) ?? [];
    const hasAny = entries.length > 0;
    const running = entries.find((e) => e.status === "running");

    // 1) Not clocked in (scheduled today, past start + 15m, no entry yet)
    if (shift && !shift.is_off_day && shift.start_time) {
      const minsSinceStart =
        timeToMinutes(currentTime) - timeToMinutes(shift.start_time.slice(0, 5));
      if (minsSinceStart >= 15 && !hasAny) {
        issues.push({
          type: "not_clocked_in",
          employee_id: emp.id,
          employee_name: emp.full_name,
          employee_role: emp.role,
          detail: `Shift started at ${shift.start_time.slice(0, 5)} — ${minsSinceStart}m ago, still not clocked in.`,
          severity: minsSinceStart >= 60 ? "urgent" : "action",
        });
      }
    }

    // 2) Long running session (> 8 hours without clock-out)
    if (running) {
      const runningHours =
        (nowMs - new Date(running.started_at).getTime()) / 1000 / 3600;
      if (runningHours >= 8) {
        issues.push({
          type: "long_running",
          employee_id: emp.id,
          employee_name: emp.full_name,
          employee_role: emp.role,
          detail: `Session running for ${runningHours.toFixed(1)}h without clock-out.`,
          severity: runningHours >= 10 ? "urgent" : "action",
        });
      }
    }

    // 3) Missed clock-out (past scheduled end + 30m, still running)
    if (
      shift &&
      !shift.is_off_day &&
      shift.end_time &&
      running &&
      timeToMinutes(currentTime) - timeToMinutes(shift.end_time.slice(0, 5)) >= 30
    ) {
      issues.push({
        type: "missed_clockout",
        employee_id: emp.id,
        employee_name: emp.full_name,
        employee_role: emp.role,
        detail: `Shift ended at ${shift.end_time.slice(0, 5)} but still running.`,
        severity: "action",
      });
    }
  }

  // 4) Auto-closed yesterday
  for (const row of (autoClosedYesterday ?? []) as Array<{
    employee_id: string;
    details: { hours?: number } | null;
  }>) {
    const emp = (employees ?? []).find(
      (e: { id: string }) => e.id === row.employee_id
    ) as { id: string; full_name: string; role: string } | undefined;
    if (!emp) continue;
    const hours = row.details?.hours ?? null;
    issues.push({
      type: "auto_closed_yesterday",
      employee_id: emp.id,
      employee_name: emp.full_name,
      employee_role: emp.role,
      detail: `Session auto-closed yesterday${hours ? ` after ${hours.toFixed(1)}h` : ""} — likely forgot to clock out.`,
      severity: "info",
    });
  }

  return Response.json({ issues });
}
