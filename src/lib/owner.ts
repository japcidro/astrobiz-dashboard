/**
 * The owner space — a second, separate dashboard behind the switch next
 * to "Astrobiz" in the sidebar. Only these Google accounts see the switch
 * or can open any /owner page; everyone else gets a 404.
 *
 * Checked against the signed-in Supabase user's email (Google-verified),
 * never against anything the browser sends.
 */
export const OWNER_EMAILS = ["japcidro@gmail.com"];

export const OWNER_HOME = "/owner";
export const OPS_HOME = "/dashboard";

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}
