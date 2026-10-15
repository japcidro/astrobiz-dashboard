import type { UserRole } from "@/lib/types";

/**
 * The Development Dashboard — a second, separate dashboard behind the
 * switch next to "Astrobiz" in the sidebar, where new tools are built and
 * tried before they move to Operations. The owner and the marketing team
 * see the switch and can open /owner pages; everyone else gets a 404.
 * Some tabs (Mobile App) stay owner-only.
 *
 * The owner is checked against the signed-in Supabase user's email
 * (Google-verified), the team against the employee's role, never against
 * anything the browser sends.
 */
export const OWNER_EMAILS = ["japcidro@gmail.com"];

/** Employee roles that can open the Development Dashboard besides the owner. */
export const DEV_DASHBOARD_ROLES: UserRole[] = ["marketing"];

export const OWNER_HOME = "/owner";
export const OPS_HOME = "/dashboard";

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}

/** The owner, or a team role listed above. */
export function canOpenDevDashboard(email: string | null | undefined, role: UserRole | null | undefined): boolean {
  return isOwnerEmail(email) || (!!role && DEV_DASHBOARD_ROLES.includes(role));
}
