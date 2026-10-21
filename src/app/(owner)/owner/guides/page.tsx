import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { GuidesPage } from "@/components/guides/guides-page";

export const dynamic = "force-dynamic";

// The same Guides tab, reached from the Development Dashboard's sidebar.
export default async function OwnerGuidesRoute() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <GuidesPage employee={employee} email={user?.email} />;
}
