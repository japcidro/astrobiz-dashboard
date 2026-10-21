import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { GuidesPage } from "@/components/guides/guides-page";

export const dynamic = "force-dynamic";

export default async function GuidesRoute() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin" && employee.role !== "marketing") redirect("/dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <GuidesPage employee={employee} email={user?.email} />;
}
