import { notFound, redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { canOpenDevDashboard, isOwnerEmail } from "@/lib/owner";
import { Sidebar } from "@/components/layout/sidebar";
import { ThemeSync } from "@/components/theme/theme-sync";
import { asTheme } from "@/lib/theme";
import { Suspense } from "react";
import { GuideRunner } from "@/components/guides/guide-runner";
import { loadGuideProgress } from "@/lib/guides/load";

export const dynamic = "force-dynamic";

// The Development Dashboard: same shell as the operations dashboard, its
// own navigation. Owner and marketing team; see src/lib/owner.ts.
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
  const employee = await getEmployee();
  if (!employee) redirect("/dashboard");
  // A 404, not a redirect: nobody else should learn this space exists.
  if (!canOpenDevDashboard(user.email, employee.role)) notFound();

  const theme = asTheme(employee.theme);
  const guideProgress = await loadGuideProgress(employee);

  return (
    <div className="flex h-dvh bg-canvas">
      <ThemeSync theme={theme} />
      <Sidebar
        employeeName={employee.full_name}
        employeeRole={employee.role}
        theme={theme}
        devAccess
        isOwner={isOwnerEmail(user.email)}
        space="owner"
      />
      <main className="flex-1 overflow-auto">
        <div className="p-4 pt-16 lg:p-8">{children}</div>
      </main>
      <Suspense fallback={null}>
        <GuideRunner progress={guideProgress} />
      </Suspense>
    </div>
  );
}
