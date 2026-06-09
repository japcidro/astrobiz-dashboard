import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { SubmittedVideosView } from "@/components/marketing/submitted/submitted-videos-view";

export const dynamic = "force-dynamic";

export default async function SubmittedVideosPage() {
  const employee = await getEmployee();

  if (!employee || !["admin", "marketing"].includes(employee.role)) {
    redirect("/dashboard");
  }

  // Narrowed by the guard above — only admin/marketing reach this point.
  return <SubmittedVideosView role={employee.role as "admin" | "marketing"} />;
}
