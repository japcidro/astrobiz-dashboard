import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { PagePostings } from "@/components/marketing/page-postings/page-postings";

export const dynamic = "force-dynamic";

export default async function PagePostingsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  return <PagePostings />;
}
