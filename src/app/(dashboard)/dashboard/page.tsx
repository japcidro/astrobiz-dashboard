import { getEmployee } from "@/lib/supabase/get-employee";
import { redirect } from "next/navigation";
import { Clock, CheckCircle, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");

  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // Get today's time entries
  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", employee.id)
    .eq("date", today);

  const totalSecondsToday = (todayEntries ?? []).reduce(
    (sum, e) => sum + (e.total_seconds || 0),
    0
  );
  const hoursToday = Math.floor(totalSecondsToday / 3600);
  const minutesToday = Math.floor((totalSecondsToday % 3600) / 60);

  const hasActiveSession = (todayEntries ?? []).some(
    (e) => e.status === "running" || e.status === "paused"
  );

  const greeting = getGreeting();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          {greeting}, {employee.full_name.split(" ")[0]}!
        </h1>
        <p className="text-gray-400 mt-1">
          Here&apos;s your overview for today.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <Clock size={20} className="text-blue-400" />
            </div>
            <span className="text-sm text-gray-400">Hours Today</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {hoursToday}h {minutesToday}m
          </p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-600/20 rounded-lg">
              <CheckCircle size={20} className="text-green-400" />
            </div>
            <span className="text-sm text-gray-400">Status</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {hasActiveSession ? "Clocked In" : "Not Clocked In"}
          </p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-600/20 rounded-lg">
              <TrendingUp size={20} className="text-purple-400" />
            </div>
            <span className="text-sm text-gray-400">Role</span>
          </div>
          <p className="text-2xl font-bold text-white capitalize">
            {employee.role}
          </p>
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/time-tracker"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Clock size={20} className="text-blue-400" />
            <div>
              <p className="text-sm font-medium text-white">Time Tracker</p>
              <p className="text-xs text-gray-400">
                {hasActiveSession ? "View active session" : "Start your timer"}
              </p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
