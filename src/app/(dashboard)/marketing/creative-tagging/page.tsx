import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { AdAttributionForm } from "@/components/kpi/ad-attribution-form";

export const dynamic = "force-dynamic";

export default async function CreativeTaggingPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "marketing" && employee.role !== "admin") {
    redirect("/dashboard");
  }
  return <AdAttributionForm />;
}
