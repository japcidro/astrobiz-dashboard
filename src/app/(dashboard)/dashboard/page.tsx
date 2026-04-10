import { getEmployee } from "@/lib/supabase/get-employee";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export default async function DashboardPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");

  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // Get this employee's time entries for today
  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", employee.id)
    .eq("date", today);

  const totalSecondsToday = (todayEntries ?? []).reduce(
    (sum, e) => sum + (e.total_seconds || 0),
    0
  );
  const hoursToday = `${Math.floor(totalSecondsToday / 3600)}h ${Math.floor((totalSecondsToday % 3600) / 60)}m`;

  const hasActiveSession = (todayEntries ?? []).some(
    (e) => e.status === "running" || e.status === "paused"
  );

  // Admin: get team-wide time data
  let teamTotalHours = 0;
  let teamNotClockedIn = 0;

  if (employee.role === "admin") {
    const { data: allEntries } = await supabase
      .from("time_entries")
      .select("employee_id, total_seconds, status")
      .eq("date", today);

    const { data: allEmployees } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true);

    const totalTeamSeconds = (allEntries ?? []).reduce(
      (sum, e) => sum + (e.total_seconds || 0),
      0
    );
    teamTotalHours = totalTeamSeconds;

    // Find employees who have no running/paused session today
    const clockedInIds = new Set(
      (allEntries ?? [])
        .filter((e) => e.status === "running" || e.status === "paused")
        .map((e) => e.employee_id)
    );
    const totalActive = (allEmployees ?? []).length;
    teamNotClockedIn = totalActive - clockedInIds.size;
  }

  return (
    <DashboardContent
      role={employee.role}
      employeeName={employee.full_name}
      hoursToday={hoursToday}
      hasActiveSession={hasActiveSession}
      teamTotalHours={teamTotalHours}
      teamNotClockedIn={teamNotClockedIn}
    />
  );
}
