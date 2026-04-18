import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    id: employee.id,
    email: employee.email,
    full_name: employee.full_name,
    role: employee.role,
  });
}
