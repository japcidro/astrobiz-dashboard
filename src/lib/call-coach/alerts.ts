import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "@/lib/alerts/insert";
import { RECORDED_ROLES, type ReviewRow } from "./shared";

/**
 * Call Coach alerts. After a day is reviewed, the owner's bell gets what
 * needs attention (no upsell all day, a score drop, a cluster of RTS-risk
 * calls) and the VA gets their score as a notification. Separately, a VA
 * who clocked in but whose mic never sent a minute is flagged.
 */

const OWNER_URL = "/owner/call-coach";
const VA_URL = "/va/my-calls";
/** A day is only ever one day; dedup wide so a manual re-review does not re-alert. */
const DEDUP_HOURS = 72;

const NO_UPSELL_MIN_REACHED = 4;
const LOW_UPSELL_MIN_REACHED = 8;
const LOW_UPSELL_RATE = 0.25;
const SCORE_DROP = 0.6;
const SCORE_FLOOR = 2.8;
const RTS_RISK_MIN = 3;

export async function raiseReviewAlerts(db: SupabaseClient, review: ReviewRow, employeeName: string): Promise<string[]> {
  if (review.status !== "done") return [];
  const raised: string[] = [];
  const first = employeeName.split(" ")[0] || employeeName;
  const key = (rule: string) => `${review.employee_id}:${review.date}:${rule}`;

  // No upsell at all on a day with real conversations.
  if (review.reached_count >= NO_UPSELL_MIN_REACHED && review.upsell_attempted === 0) {
    const id = await insertAlert(db, {
      type: "call_coach_no_upsell",
      severity: "action",
      title: `${first} made no upsell offer all day`,
      body: `${review.reached_count} customers reached on ${review.date}, zero bundle or add-on offers. Open the scorecard to hear the calls.`,
      resource_type: "employee",
      resource_id: key("no_upsell"),
      action_url: OWNER_URL,
      payload: { employee_id: review.employee_id, date: review.date, reached: review.reached_count },
      dedup_hours: DEDUP_HOURS,
    });
    if (id) raised.push("no_upsell");
  } else if (review.reached_count >= LOW_UPSELL_MIN_REACHED && review.upsell_attempted / review.reached_count < LOW_UPSELL_RATE) {
    const rate = Math.round((review.upsell_attempted / review.reached_count) * 100);
    const id = await insertAlert(db, {
      type: "call_coach_no_upsell",
      severity: "info",
      title: `${first} upsold on only ${rate}% of reached calls`,
      body: `${review.upsell_attempted} offers across ${review.reached_count} reached customers on ${review.date}.`,
      resource_type: "employee",
      resource_id: key("low_upsell"),
      action_url: OWNER_URL,
      payload: { employee_id: review.employee_id, date: review.date, rate },
      dedup_hours: DEDUP_HOURS,
    });
    if (id) raised.push("low_upsell");
  }

  // Score drop against the VA's own last seven days, or below the floor outright.
  if (review.score !== null) {
    const { data: prior } = await db
      .from("call_coach_reviews")
      .select("score")
      .eq("employee_id", review.employee_id)
      .eq("status", "done")
      .lt("date", review.date)
      .gte("date", shiftDate(review.date, -7))
      .not("score", "is", null);
    const scores = (prior ?? []).map((r) => Number(r.score));
    const baseline = scores.length >= 2 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const dropped = baseline !== null && review.score <= baseline - SCORE_DROP;
    const low = review.score < SCORE_FLOOR && review.calls_count >= 3;
    if (dropped || low) {
      const id = await insertAlert(db, {
        type: "call_coach_score_drop",
        severity: "action",
        title: dropped
          ? `${first}'s call score fell to ${review.score.toFixed(1)} (was ${baseline!.toFixed(1)})`
          : `${first}'s call score is ${review.score.toFixed(1)} today`,
        body: review.coaching[0] ?? review.summary ?? undefined,
        resource_type: "employee",
        resource_id: key("score_drop"),
        action_url: OWNER_URL,
        payload: { employee_id: review.employee_id, date: review.date, score: review.score, baseline },
        dedup_hours: DEDUP_HOURS,
      });
      if (id) raised.push("score_drop");
    }
  }

  // Several customers left unsure: those orders tend to come back as RTS.
  const { data: risky } = await db.from("call_coach_calls").select("id, started_at").eq("review_id", review.id).contains("flags", ["rts_risk"]);
  if ((risky?.length ?? 0) >= RTS_RISK_MIN) {
    const id = await insertAlert(db, {
      type: "call_coach_rts_risk",
      severity: "info",
      title: `${risky!.length} RTS-risk calls on ${first}'s shift`,
      body: `Customers who stayed unsure after a hesitation on ${review.date}. Worth a same-day follow-up text.`,
      resource_type: "employee",
      resource_id: key("rts_risk"),
      action_url: OWNER_URL,
      payload: { employee_id: review.employee_id, date: review.date, count: risky!.length },
      dedup_hours: DEDUP_HOURS,
    });
    if (id) raised.push("rts_risk");
  }

  return raised;
}

/** The VA's own copy: today's score and the first coaching point. One per day. */
export async function notifyEmployeeOfReview(db: SupabaseClient, review: ReviewRow): Promise<boolean> {
  if (review.status !== "done" || review.score === null) return false;
  const { data: existing } = await db
    .from("employee_notifications")
    .select("id")
    .eq("employee_id", review.employee_id)
    .eq("type", "call_coach_review")
    .contains("payload", { date: review.date })
    .limit(1);
  if (existing && existing.length > 0) return false;

  const { error } = await db.from("employee_notifications").insert({
    employee_id: review.employee_id,
    type: "call_coach_review",
    severity: "info",
    title: `Your call score for ${review.date}: ${review.score.toFixed(1)} / 5`,
    body: review.coaching[0] ?? review.summary ?? null,
    action_url: VA_URL,
    payload: { date: review.date, score: review.score, calls: review.calls_count },
  });
  return !error;
}

/**
 * VAs who clocked in on a Manila date but whose recorder never uploaded a
 * minute: the tab was closed, the mic was blocked, or they skipped consent.
 */
export async function raiseNotRecordedAlerts(db: SupabaseClient, date: string): Promise<string[]> {
  const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+08:00`).toISOString();
  const [{ data: employees }, { data: entries }, { data: segments }, { data: events }] = await Promise.all([
    db.from("employees").select("id, full_name, role").in("role", [...RECORDED_ROLES]).eq("is_active", true),
    db.from("time_entries").select("employee_id, total_seconds, status").gte("started_at", dayStart).lte("started_at", dayEnd),
    db.from("call_coach_segments").select("employee_id").eq("date", date),
    db.from("call_coach_mic_events").select("employee_id, kind").eq("date", date).in("kind", ["blocked", "lost"]),
  ]);
  const recorded = new Set((segments ?? []).map((s) => s.employee_id as string));
  const trouble = new Map<string, string>();
  for (const e of events ?? []) trouble.set(e.employee_id as string, e.kind as string);
  const worked = new Map<string, number>();
  for (const t of entries ?? []) {
    const id = t.employee_id as string;
    worked.set(id, (worked.get(id) ?? 0) + Number(t.total_seconds ?? 0));
  }

  const raised: string[] = [];
  for (const emp of employees ?? []) {
    if (emp.role !== "va") continue; // admins test the recorder; no alert for them
    const id = emp.id as string;
    if (!worked.has(id) || recorded.has(id)) continue;
    const why = trouble.get(id) === "blocked" ? "Chrome blocked the microphone" : trouble.get(id) === "lost" ? "the microphone disconnected and was not resumed" : "the recorder never started (consent not signed, or the tab was closed)";
    const alertId = await insertAlert(db, {
      type: "call_coach_not_recorded",
      severity: "action",
      title: `${(emp.full_name as string).split(" ")[0]}'s shift on ${date} was not recorded`,
      body: `They clocked in, but no minute of audio arrived: ${why}.`,
      resource_type: "employee",
      resource_id: `${id}:${date}:not_recorded`,
      action_url: OWNER_URL,
      payload: { employee_id: id, date, reason: trouble.get(id) ?? "none" },
      dedup_hours: DEDUP_HOURS,
    });
    if (alertId) raised.push(id);
  }
  return raised;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
