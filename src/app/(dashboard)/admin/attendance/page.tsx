import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { Clock, User, CheckCircle, XCircle } from "lucide-react";

export default async function AttendancePage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // Get all active employees
  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .eq("is_active", true)
    .order("full_name");

  // Get today's time entries for all employees
  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("date", today);

  // Get this week's entries (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: weekEntries } = await supabase
    .from("time_entries")
    .select("*")
    .gte("date", sevenDaysAgo.toISOString().split("T")[0]);

  // Build employee summary
  const employeeSummaries = (employees ?? []).map((emp) => {
    const empTodayEntries = (todayEntries ?? []).filter(
      (e) => e.employee_id === emp.id
    );
    const empWeekEntries = (weekEntries ?? []).filter(
      (e) => e.employee_id === emp.id
    );

    const todaySeconds = empTodayEntries.reduce(
      (sum, e) => sum + (e.total_seconds || 0),
      0
    );
    const weekSeconds = empWeekEntries.reduce(
      (sum, e) => sum + (e.total_seconds || 0),
      0
    );

    const isActive = empTodayEntries.some(
      (e) => e.status === "running" || e.status === "paused"
    );
    const isPaused = empTodayEntries.some((e) => e.status === "paused");

    return {
      ...emp,
      todaySeconds,
      weekSeconds,
      isActive,
      isPaused,
    };
  });

  const totalActiveNow = employeeSummaries.filter((e) => e.isActive).length;

  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  const roleColors: Record<string, string> = {
    admin: "bg-purple-600",
    va: "bg-blue-600",
    fulfillment: "bg-green-600",
    marketing: "bg-orange-600",
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Team Attendance</h1>
        <p className="text-gray-400 mt-1">
          {format(new Date(), "EEEE, MMMM d, yyyy")}
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <User size={20} className="text-blue-400" />
            </div>
            <span className="text-sm text-gray-400">Total Employees</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {employees?.length ?? 0}
          </p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-600/20 rounded-lg">
              <CheckCircle size={20} className="text-green-400" />
            </div>
            <span className="text-sm text-gray-400">Active Now</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalActiveNow}</p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-red-600/20 rounded-lg">
              <XCircle size={20} className="text-red-400" />
            </div>
            <span className="text-sm text-gray-400">Not Clocked In</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {(employees?.length ?? 0) - totalActiveNow}
          </p>
        </div>
      </div>

      {/* Employee Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/50">
                <th className="text-left text-sm font-medium text-gray-400 px-6 py-4">
                  Employee
                </th>
                <th className="text-left text-sm font-medium text-gray-400 px-6 py-4">
                  Role
                </th>
                <th className="text-left text-sm font-medium text-gray-400 px-6 py-4">
                  Status
                </th>
                <th className="text-right text-sm font-medium text-gray-400 px-6 py-4">
                  Today
                </th>
                <th className="text-right text-sm font-medium text-gray-400 px-6 py-4">
                  This Week
                </th>
              </tr>
            </thead>
            <tbody>
              {employeeSummaries.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-b border-gray-700/30 last:border-0"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
                        {emp.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {emp.full_name}
                        </p>
                        <p className="text-xs text-gray-500">{emp.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium text-white uppercase ${roleColors[emp.role] ?? "bg-gray-600"}`}
                    >
                      {emp.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {emp.isActive ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        {emp.isPaused ? (
                          <>
                            <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                            <span className="text-yellow-400">On Break</span>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                            <span className="text-green-400">Working</span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className="w-2 h-2 bg-gray-500 rounded-full" />
                        <span className="text-gray-500">Offline</span>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-medium text-white">
                      {formatDuration(emp.todaySeconds)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-medium text-white">
                      {formatDuration(emp.weekSeconds)}
                    </span>
                  </td>
                </tr>
              ))}

              {employeeSummaries.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-gray-500 text-sm"
                  >
                    No employees found. Add employees through Supabase.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
