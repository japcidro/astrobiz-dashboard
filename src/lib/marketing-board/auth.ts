import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isOwnerEmail } from "@/lib/owner";

/**
 * Owner-only gate for Marketing Board routes, same answer as the owner
 * layout: anyone else gets a 404. Also resolves the owner's employee row,
 * which notes and outputs are attributed to.
 *
 * When the board moves to the operations dashboard, this is the one place
 * to widen: accept admin + marketing roles and hand back their employee.
 */
export async function requireBoardUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwnerEmail(user.email)) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  const employee = await getEmployee();
  if (!employee) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { user, employee, db: createServiceClient() } as const;
}
