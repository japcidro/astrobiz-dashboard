import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isOwnerEmail } from "@/lib/owner";
import type { Employee } from "@/lib/types";
import { CALL_COACH_BUCKET, RECORDED_ROLES, type CallCoachConsent } from "./shared";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

/**
 * The recorder's own routes: a signed-in VA (or admin, for testing) acting
 * on their own shift. Anyone else gets a 404.
 */
export async function requireRecordedEmployee() {
  const employee = await getEmployee();
  if (!employee || !isRecordedRole(employee.role)) return { error: notFound() } as const;
  return { employee, db: createServiceClient() } as const;
}

/**
 * Listening and reading transcripts: the owner (by Google-verified email)
 * or an admin. The marketing team can open /owner but not this.
 */
export async function requireCoach() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: notFound() } as const;
  const employee = await getEmployee();
  if (!employee || !(isOwnerEmail(user.email) || employee.role === "admin")) return { error: notFound() } as const;
  return { employee, db: createServiceClient() } as const;
}

export function isRecordedRole(role: Employee["role"]): boolean {
  return (RECORDED_ROLES as readonly string[]).includes(role);
}

/** The employee's active consent, or null when they have not signed yet. */
export async function activeConsent(db: SupabaseClient, employeeId: string): Promise<CallCoachConsent | null> {
  const { data } = await db
    .from("call_coach_consents")
    .select("id, employee_id, signed_name, signed_at")
    .eq("employee_id", employeeId)
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CallCoachConsent | null) ?? null;
}

/** Seconds of speech stored for this employee on a PH date. */
export async function voiceSecondsOn(db: SupabaseClient, employeeId: string, date: string): Promise<number> {
  const { data } = await db.from("call_coach_segments").select("voice_seconds").eq("employee_id", employeeId).eq("date", date);
  return (data ?? []).reduce((sum, r) => sum + Number((r as { voice_seconds: number }).voice_seconds), 0);
}

/** Playback URLs last an hour; the owner page reloads a day well before that. */
const SIGNED_TTL_SECONDS = 60 * 60;

export async function signSegmentPaths(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await db.storage.from(CALL_COACH_BUCKET).createSignedUrls(paths, SIGNED_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

/**
 * The time entry a phone-uploaded call belongs to: the entry whose window
 * covers the call's start (paused and completed ones included), else the
 * latest entry of that day, else null when the VA never clocked in.
 */
export async function shiftEntryAt(db: SupabaseClient, employeeId: string, at: Date): Promise<string | null> {
  const iso = at.toISOString();
  const { data: covering } = await db
    .from("time_entries")
    .select("id")
    .eq("employee_id", employeeId)
    .lte("started_at", iso)
    .or(`ended_at.is.null,ended_at.gte.${iso}`)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (covering?.id) return covering.id as string;
  const { data: sameDay } = await db
    .from("time_entries")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("date", iso.slice(0, 10))
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (sameDay?.id as string | undefined) ?? null;
}
