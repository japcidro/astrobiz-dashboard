import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { canOpenDevDashboard } from "@/lib/owner";

/**
 * Gate for Marketing Board and Clipper routes: the owner or the marketing
 * team, the same answer as the Development Dashboard layout; anyone else
 * gets a 404. Also resolves the employee row, which notes and outputs are
 * attributed to.
 */
export async function requireBoardUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  const employee = await getEmployee();
  if (!employee || !canOpenDevDashboard(user.email, employee.role)) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { user, employee, db: createServiceClient() } as const;
}
