import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { BonusDashboardClient } from "@/components/bonus/bonus-dashboard-client";

export const dynamic = "force-dynamic";

export default async function BonusPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");

  return (
    <BonusDashboardClient
      employeeName={employee.full_name}
      isAdmin={employee.role === "admin"}
    />
  );
}
