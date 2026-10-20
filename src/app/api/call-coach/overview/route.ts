import { requireCoach } from "@/lib/call-coach/server";
import { RECORDED_ROLES, phDate, type DayTotals, type OverviewEmployee, type OverviewResponse } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

const DAYS = 14;

/** GET — every recorded employee's last 14 days: how much speech was stored each day. */
export async function GET() {
  const auth = await requireCoach();
  if (auth.error) return auth.error;
  const { db } = auth;

  const today = phDate();
  const dates: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const from = dates[dates.length - 1];

  const [{ data: employees }, { data: consents }, { data: segments }] = await Promise.all([
    db.from("employees").select("id, full_name, role").in("role", [...RECORDED_ROLES]).eq("is_active", true).order("full_name"),
    db.from("call_coach_consents").select("employee_id, signed_at").is("revoked_at", null),
    db
      .from("call_coach_segments")
      .select("employee_id, date, started_at, ended_at, voice_seconds")
      .gte("date", from)
      .order("started_at"),
  ]);

  const consentBy = new Map<string, string>();
  for (const c of consents ?? []) consentBy.set(c.employee_id as string, c.signed_at as string);

  const byEmployee = new Map<string, Record<string, DayTotals>>();
  for (const s of segments ?? []) {
    const days = byEmployee.get(s.employee_id as string) ?? {};
    const cell = days[s.date as string] ?? { segments: 0, voice_seconds: 0, first_at: s.started_at as string, last_at: s.ended_at as string };
    cell.segments += 1;
    cell.voice_seconds += Number(s.voice_seconds);
    if ((s.started_at as string) < cell.first_at) cell.first_at = s.started_at as string;
    if ((s.ended_at as string) > cell.last_at) cell.last_at = s.ended_at as string;
    days[s.date as string] = cell;
    byEmployee.set(s.employee_id as string, days);
  }

  const out: OverviewEmployee[] = (employees ?? []).map((e) => ({
    id: e.id as string,
    full_name: e.full_name as string,
    role: e.role as string,
    consented_at: consentBy.get(e.id as string) ?? null,
    days: byEmployee.get(e.id as string) ?? {},
  }));

  const body: OverviewResponse = { dates, employees: out };
  return Response.json(body);
}
