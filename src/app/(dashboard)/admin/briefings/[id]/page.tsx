import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { BriefingDetail } from "@/components/briefings/briefing-detail";

export default async function BriefingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  const { id } = await params;
  return (
    <div className="max-w-4xl mx-auto">
      <BriefingDetail id={id} />
    </div>
  );
}
