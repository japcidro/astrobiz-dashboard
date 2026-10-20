import { createServiceClient } from "@/lib/supabase/service";
import { buildWeeklyDigest, employeesWithReviews } from "@/lib/call-coach/digest";
import { phDate, phWeekStart } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Monday 7:00 AM Manila: one digest per VA for the week that just ended.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createServiceClient();
  const started = Date.now();
  // Yesterday (Manila) was Sunday; its week is the one to digest.
  const weekStart = phWeekStart(phDate(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const results: Array<{ employee_id: string; status: string; reason?: string }> = [];
  for (const employeeId of await employeesWithReviews(db, weekStart)) {
    if (Date.now() - started > 240_000) break;
    const r = await buildWeeklyDigest(db, employeeId, weekStart);
    results.push({ employee_id: employeeId, status: r.status, reason: r.reason });
  }
  return Response.json({ ok: true, week_start: weekStart, digests: results, ms: Date.now() - started });
}
