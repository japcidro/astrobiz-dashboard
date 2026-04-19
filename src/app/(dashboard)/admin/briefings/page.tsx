import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { BriefingsList } from "@/components/briefings/briefings-list";

export default async function BriefingsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Briefings</h1>
      <p className="text-sm text-gray-500 mb-6">
        Scheduled digests — morning, evening, weekly, monthly. Each includes an AI
        summary and the underlying data.
      </p>
      <BriefingsList />
    </div>
  );
}
