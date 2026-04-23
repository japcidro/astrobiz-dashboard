import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { BackgroundRefresh } from "@/components/layout/background-refresh";
import { ClockStatusBanner } from "@/components/attendance/clock-status-banner";

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

  // Authenticated but no employee record → show setup message
  if (!employee) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center">
        <div className="text-center max-w-md p-8">
          <h1 className="text-2xl font-bold text-white mb-4">
            Account Not Set Up
          </h1>
          <p className="text-gray-400 mb-2">
            You&apos;re signed in as <span className="text-white">{user.email}</span>, but your employee profile wasn&apos;t created yet.
          </p>
          <p className="text-gray-500 text-sm mb-6">
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
              className="bg-white text-gray-900 font-medium py-2 px-6 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-gray-900">
      <Sidebar
        employeeName={employee.full_name}
        employeeRole={employee.role}
      />
      <main className="flex-1 overflow-auto">
        <ClockStatusBanner />
        <div className="p-4 pt-16 lg:p-8">{children}</div>
      </main>
      <BackgroundRefresh />
    </div>
  );
}
