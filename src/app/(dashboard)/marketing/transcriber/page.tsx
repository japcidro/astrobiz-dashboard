import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { TranscriberClient } from "@/components/marketing/transcriber-client";

export const dynamic = "force-dynamic";

export default async function TranscriberPage() {
  const employee = await getEmployee();
  if (!employee || !["admin", "marketing"].includes(employee.role)) {
    redirect("/dashboard");
  }
  return <TranscriberClient />;
}
