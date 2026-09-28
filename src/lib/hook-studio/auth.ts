import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isOwnerEmail } from "@/lib/owner";

/**
 * Owner-only gate for Hook Studio routes. Anyone else gets a 404, the same
 * answer the owner layout gives, so the routes don't reveal the feature.
 * Returns a service-role client: the tables have no anon policies.
 */
export async function requireOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwnerEmail(user.email)) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { user, db: createServiceClient() } as const;
}
