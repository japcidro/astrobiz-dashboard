import { requireCoach } from "@/lib/call-coach/server";
import { buildWeeklyDigest } from "@/lib/call-coach/digest";
import { phDate, phWeekStart, type DigestRow } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?employee_id — that VA's digests, newest week first. */
export async function GET(request: Request) {
  const auth = await requireCoach();
  if (auth.error) return auth.error;
  const employeeId = new URL(request.url).searchParams.get("employee_id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(employeeId)) return Response.json({ error: "Pick an employee" }, { status: 400 });
  const { data, error } = await auth.db.from("call_coach_digests").select("*").eq("employee_id", employeeId).order("week_start", { ascending: false }).limit(8);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const digests = ((data ?? []) as DigestRow[]).map((d) => ({ ...d, score: d.score === null ? null : Number(d.score), prev_score: d.prev_score === null ? null : Number(d.prev_score) }));
  return Response.json({ digests });
}

/** POST { employee_id, week_start? } — write (or rewrite) the digest for a week; defaults to the week that last ended. */
export async function POST(request: Request) {
  const auth = await requireCoach();
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { employee_id?: string; week_start?: string } | null;
  const employeeId = body?.employee_id ?? "";
  if (!/^[0-9a-f-]{36}$/.test(employeeId)) return Response.json({ error: "Pick an employee" }, { status: 400 });
  const requested = body?.week_start && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start) ? phWeekStart(body.week_start) : null;
  const thisWeek = phWeekStart(phDate());
  // Default: last full week; this week only when asked for explicitly.
  const weekStart = requested ?? phWeekStart(new Date(new Date(`${thisWeek}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const result = await buildWeeklyDigest(auth.db, employeeId, weekStart, { force: true });
  if (result.status === "failed") return Response.json({ error: result.reason }, { status: 500 });
  return Response.json(result);
}
