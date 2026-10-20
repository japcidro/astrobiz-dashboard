import { requireCoach } from "@/lib/call-coach/server";
import { RECORDED_ROLES, phDate, type DayReviewSummary, type DayTotals, type OverviewEmployee, type OverviewResponse } from "@/lib/call-coach/shared";

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

  const [{ data: employees }, { data: consents }, { data: segments }, { data: reviews }] = await Promise.all([
    db.from("employees").select("id, full_name, role").in("role", [...RECORDED_ROLES]).eq("is_active", true).order("full_name"),
    db.from("call_coach_consents").select("employee_id, signed_at").is("revoked_at", null),
    db
      .from("call_coach_segments")
      .select("employee_id, date, started_at, ended_at, voice_seconds, status")
      .gte("date", from)
      .order("started_at"),
    db.from("call_coach_reviews").select("employee_id, date, status, score, calls_count").gte("date", from),
  ]);

  const consentBy = new Map<string, string>();
  for (const c of consents ?? []) consentBy.set(c.employee_id as string, c.signed_at as string);

  const pendingBy = new Map<string, number>();
  const byEmployee = new Map<string, Record<string, DayTotals>>();
  for (const s of segments ?? []) {
    if (s.status === "stored") {
      const k = `${s.employee_id}|${s.date}`;
      pendingBy.set(k, (pendingBy.get(k) ?? 0) + 1);
    }
    const days = byEmployee.get(s.employee_id as string) ?? {};
    const cell = days[s.date as string] ?? { segments: 0, voice_seconds: 0, first_at: s.started_at as string, last_at: s.ended_at as string };
    cell.segments += 1;
    cell.voice_seconds += Number(s.voice_seconds);
    if ((s.started_at as string) < cell.first_at) cell.first_at = s.started_at as string;
    if ((s.ended_at as string) > cell.last_at) cell.last_at = s.ended_at as string;
    days[s.date as string] = cell;
    byEmployee.set(s.employee_id as string, days);
  }

  const reviewBy = new Map<string, Record<string, DayReviewSummary>>();
  for (const r of reviews ?? []) {
    const days = reviewBy.get(r.employee_id as string) ?? {};
    days[r.date as string] = {
      score: r.score === null ? null : Number(r.score),
      calls: Number(r.calls_count),
      status: r.status as DayReviewSummary["status"],
      pending: pendingBy.get(`${r.employee_id}|${r.date}`) ?? 0,
    };
    reviewBy.set(r.employee_id as string, days);
  }
  // Days with audio but no review yet still report how many minutes wait for a transcript.
  for (const [k, n] of pendingBy) {
    const [empId, d] = k.split("|");
    const days = reviewBy.get(empId) ?? {};
    if (!days[d]) days[d] = { score: null, calls: 0, status: "queued", pending: n };
    reviewBy.set(empId, days);
  }

  const out: OverviewEmployee[] = (employees ?? []).map((e) => ({
    id: e.id as string,
    full_name: e.full_name as string,
    role: e.role as string,
    consented_at: consentBy.get(e.id as string) ?? null,
    days: byEmployee.get(e.id as string) ?? {},
    reviews: reviewBy.get(e.id as string) ?? {},
  }));

  const body: OverviewResponse = { dates, employees: out };
  return Response.json(body);
}
