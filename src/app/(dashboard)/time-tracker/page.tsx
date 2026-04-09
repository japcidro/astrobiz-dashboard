import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { RunningTimer } from "@/components/timer/running-timer";
import { ManualEntryForm } from "@/components/timer/manual-entry-form";
import { TimeHistory } from "@/components/timer/time-history";

export default async function TimeTrackerPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");

  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // Get active session (running or paused) for today
  const { data: activeEntries } = await supabase
    .from("time_entries")
    .select("*, time_pauses(*)")
    .eq("employee_id", employee.id)
    .eq("date", today)
    .in("status", ["running", "paused"])
    .order("started_at", { ascending: false })
    .limit(1);

  const activeEntry = activeEntries?.[0] ?? null;

  // Get recent entries (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", employee.id)
    .gte("date", sevenDaysAgo.toISOString().split("T")[0])
    .order("date", { ascending: false })
    .order("started_at", { ascending: false });

  // Calculate today's total
  const todayEntries = (recentEntries ?? []).filter((e) => e.date === today);
  const todayTotal = todayEntries.reduce(
    (sum, e) => sum + (e.total_seconds || 0),
    0
  );
  const todayHours = Math.floor(todayTotal / 3600);
  const todayMinutes = Math.floor((todayTotal % 3600) / 60);

  // Calculate this week's total
  const weekTotal = (recentEntries ?? []).reduce(
    (sum, e) => sum + (e.total_seconds || 0),
    0
  );
  const weekHours = Math.floor(weekTotal / 3600);
  const weekMinutes = Math.floor((weekTotal % 3600) / 60);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Time Tracker</h1>
        <p className="text-gray-400 mt-1">Track your work hours</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Today</p>
          <p className="text-xl font-bold text-white mt-1">
            {todayHours}h {todayMinutes}m
          </p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">This Week</p>
          <p className="text-xl font-bold text-white mt-1">
            {weekHours}h {weekMinutes}m
          </p>
        </div>
      </div>

      {/* Timer + Manual Entry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <RunningTimer activeEntry={activeEntry} />
        <ManualEntryForm />
      </div>

      {/* History */}
      <TimeHistory entries={recentEntries ?? []} />
    </div>
  );
}
