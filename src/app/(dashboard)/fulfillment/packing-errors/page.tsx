import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { PackingErrorsForm } from "@/components/kpi/packing-errors-form";

export const dynamic = "force-dynamic";

export default async function PackingErrorsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    redirect("/dashboard");
  }
  const supabase = await createClient();
  const { data: packers } = await supabase
    .from("employees")
    .select("id, full_name, role")
    .eq("is_active", true)
    .eq("role", "fulfillment")
    .order("full_name");

  return <PackingErrorsForm packers={packers ?? []} />;
}
