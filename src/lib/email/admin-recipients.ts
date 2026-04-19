import type { SupabaseClient } from "@supabase/supabase-js";

// Admin emails = employees.role='admin' + fallback to japcidro@gmail.com.
// Deduplicated. Service client required (bypasses RLS).
export async function getAdminEmails(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("employees")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true);

  const emails = new Set<string>();
  for (const row of (data ?? []) as { email: string }[]) {
    if (row.email) emails.add(row.email.toLowerCase());
  }
  // Always include the owner as a guaranteed recipient
  emails.add("japcidro@gmail.com");
  return Array.from(emails);
}
