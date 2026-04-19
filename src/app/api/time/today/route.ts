import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Returns today's time entries summary for the current user.
// Used by the persistent clock-in status banner.
export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: entries } = await supabase
    .from("time_entries")
    .select("id, status, started_at, ended_at, total_seconds")
    .eq("employee_id", employee.id)
    .eq("date", today);

  const list = entries ?? [];
  const running = list.find((e) => e.status === "running") ?? null;
  const paused = list.some((e) => e.status === "paused");
  const total_seconds = list.reduce(
    (s, e) => s + (e.total_seconds || 0),
    0
  );

  return Response.json({
    running: running
      ? {
          id: running.id,
          started_at: running.started_at,
          total_seconds: running.total_seconds || 0,
        }
      : null,
    paused,
    total_seconds,
  });
}
