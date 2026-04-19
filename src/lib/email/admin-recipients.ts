import type { SupabaseClient } from "@supabase/supabase-js";

// Admin emails for alert recipients.
//
// If ALERT_RECIPIENTS env is set (comma-separated), use that verbatim.
// Useful when using Resend's onboarding@resend.dev sender — only the
// Resend signup email can receive, so we must restrict the list.
//
// Otherwise fall back to all admin employees + japcidro@gmail.com.
export async function getAdminEmails(supabase: SupabaseClient): Promise<string[]> {
  const override = process.env.ALERT_RECIPIENTS;
  if (override) {
    return override
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);
  }

  const { data } = await supabase
    .from("employees")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true);

  const emails = new Set<string>();
  for (const row of (data ?? []) as { email: string }[]) {
    if (row.email) emails.add(row.email.toLowerCase());
  }
  emails.add("japcidro@gmail.com");
  return Array.from(emails);
}
