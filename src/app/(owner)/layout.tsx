import { notFound, redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { isOwnerEmail } from "@/lib/owner";
import { Sidebar } from "@/components/layout/sidebar";

export const dynamic = "force-dynamic";

// The owner space: same shell as the operations dashboard, its own
// navigation, and nothing else yet. Owner-only; see src/lib/owner.ts.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  // A 404, not a redirect: nobody else should learn this space exists.
  if (!isOwnerEmail(user.email)) notFound();

  const employee = await getEmployee();
  if (!employee) redirect("/dashboard");

  return (
    <div className="flex h-dvh bg-gray-900">
      <Sidebar
        employeeName={employee.full_name}
        employeeRole={employee.role}
        isOwner
        space="owner"
      />
      <main className="flex-1 overflow-auto">
        <div className="p-4 pt-16 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
