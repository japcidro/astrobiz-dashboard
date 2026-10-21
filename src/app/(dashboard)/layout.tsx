import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { alertUnauthorizedAccess } from "@/lib/alerts/unauthorized-access";
import { Sidebar } from "@/components/layout/sidebar";
import { BackgroundRefresh } from "@/components/layout/background-refresh";
import { ThemeSync } from "@/components/theme/theme-sync";
import { ClockStatusBanner } from "@/components/attendance/clock-status-banner";
import { canOpenDevDashboard, isOwnerEmail } from "@/lib/owner";
import { asTheme } from "@/lib/theme";
import { Suspense } from "react";
import { GuideRunner } from "@/components/guides/guide-runner";
import { loadGuideProgress } from "@/lib/guides/load";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated at all → login
  if (!user) {
    redirect("/login");
  }

  const employee = await getEmployee();

  // Authenticated but no employee record → show setup message.
  // Email the admin (deduped: once per unknown account). Awaited but guarded —
  // alertUnauthorizedAccess never throws, so this can't block the bounce.
  if (!employee) {
    await alertUnauthorizedAccess(user.id, user.email ?? undefined);
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="max-w-md p-8 text-center">
          <h1 className="mb-4 text-2xl text-fg">Account not set up</h1>
          <p className="mb-2 text-muted">
            You&apos;re signed in as <span className="text-fg">{user.email}</span>, but your employee profile wasn&apos;t created yet.
          </p>
          <p className="mb-6 text-sm text-dim">
            Ask your admin to add you, or check the Supabase logs for trigger errors.
          </p>
          <form
            action={async () => {
              "use server";
              const supabase = await createClient();
              await supabase.auth.signOut();
              redirect("/login");
            }}
          >
            <button
              type="submit"
              className="cursor-pointer rounded-control border border-line-strong bg-raised px-6 py-2 font-medium text-fg transition-colors hover:bg-panel"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  const theme = asTheme(employee.theme);
  const guideProgress = await loadGuideProgress(employee);

  return (
    <div className="flex h-dvh bg-canvas">
      <ThemeSync theme={theme} />
      <Sidebar
        employeeName={employee.full_name}
        employeeRole={employee.role}
        theme={theme}
        devAccess={canOpenDevDashboard(user.email, employee.role)}
        isOwner={isOwnerEmail(user.email)}
      />
      <main className="flex-1 overflow-auto">
        <ClockStatusBanner />
        <div className="p-4 pt-16 lg:p-8">{children}</div>
      </main>
      <Suspense fallback={null}>
        <GuideRunner progress={guideProgress} />
      </Suspense>
      <BackgroundRefresh />
    </div>
  );
}
