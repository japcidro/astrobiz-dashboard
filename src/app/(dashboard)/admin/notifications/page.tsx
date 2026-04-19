import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/supabase/get-employee";
import { NotificationsInbox } from "@/components/alerts/notifications-inbox";

export default async function NotificationsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (employee.role !== "admin") redirect("/dashboard");

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Notifications</h1>
      <p className="text-sm text-gray-500 mb-6">
        Decision-support alerts from the rule engine. Runs every 30 minutes.
      </p>
      <NotificationsInbox />
    </div>
  );
}
