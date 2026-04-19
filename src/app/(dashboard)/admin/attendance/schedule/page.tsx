import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { ScheduleEditor } from "@/components/attendance/schedule-editor";

export default async function SchedulePage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Employee Schedule</h1>
      <p className="text-sm text-gray-500 mb-6">
        Set each employee&apos;s shift per day. The attendance-check runs every
        15 minutes and sends reminders based on this schedule.
      </p>
      <ScheduleEditor />
    </div>
  );
}
