import { TasksBoard } from "@/components/tasks/tasks-board";
import { getEmployee } from "@/lib/supabase/get-employee";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");

  return (
    <TasksBoard
      currentEmployeeId={employee.id}
      currentRole={employee.role}
    />
  );
}
