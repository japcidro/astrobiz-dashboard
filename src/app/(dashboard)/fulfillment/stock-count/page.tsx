import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { StockCountForm } from "@/components/kpi/stock-count-form";

export const dynamic = "force-dynamic";

export default async function StockCountPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    redirect("/dashboard");
  }
  return <StockCountForm />;
}
