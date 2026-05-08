import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { loadKpiDashboard } from "@/lib/kpi/queries";
import { KpiDashboardClient } from "@/components/kpi/kpi-dashboard-client";

export const dynamic = "force-dynamic";

export default async function KpiDashboardPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  const { tiles, asOf } = await loadKpiDashboard();

  return <KpiDashboardClient tiles={tiles} asOf={asOf} />;
}
