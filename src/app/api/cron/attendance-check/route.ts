import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/resend";
import {
  buildClockinReminder,
  buildBreakReminder,
  buildClockoutReminder,
  buildAutoCloseNotification,
  buildAdminAutoCloseAlert,
} from "@/lib/attendance/email-templates";
import { insertAlert } from "@/lib/alerts/insert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AUTO_CLOSE_HOURS = 10;
const CLOCKIN_GRACE_MIN = 15;
const CLOCKOUT_GRACE_MIN = 15;
const BREAK_AFTER_HOURS = 4;

// Return "today in PHT" as YYYY-MM-DD
function phtTodayString(now: Date): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

// Return current HH:MM in PHT (24-hour)
function phtTimeString(now: Date): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const h = String(pht.getUTCHours()).padStart(2, "0");
  const m = String(pht.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Compute minutes since `startTime` (HH:MM) up to `currentTime` (HH:MM).
// Negative if current is before start.
function minutesSince(startTime: string, currentTime: string): number {
  return timeToMinutes(currentTime) - timeToMinutes(startTime);
}

interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface Shift {
  employee_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  is_off_day: boolean;
}

interface TimeEntry {
  id: string;
  employee_id: string;
  status: string;
  started_at: string;
  total_seconds: number;
  date: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;
  const now = new Date();
  const today = phtTodayString(now);
  const currentTime = phtTimeString(now);

  const results = {
    clockin_reminders: 0,
    break_reminders: 0,
    clockout_reminders: 0,
    auto_closed: 0,
    emails_sent: 0,
    emails_failed: 0,
  };

  // Fetch today's shifts + active employees
  const { data: shifts } = await supabase
    .from("employee_shifts")
    .select("*")
    .eq("shift_date", today);

  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, email, role")
    .eq("is_active", true);

  if (!employees || employees.length === 0) {
    return Response.json({ success: true, results, note: "no active employees" });
  }

  const shiftByEmployee = new Map<string, Shift>();
  for (const s of (shifts ?? []) as Shift[]) shiftByEmployee.set(s.employee_id, s);

  // Fetch today's time entries for all employees (running, paused, or completed)
  const { data: entries } = await supabase
    .from("time_entries")
    .select("id, employee_id, status, started_at, total_seconds, date")
    .eq("date", today);

  const entriesByEmployee = new Map<string, TimeEntry[]>();
  for (const e of (entries ?? []) as TimeEntry[]) {
    const list = entriesByEmployee.get(e.employee_id) ?? [];
    list.push(e);
    entriesByEmployee.set(e.employee_id, list);
  }

  async function notifyEmployee(
    emp: Employee,
    type: string,
    severity: "info" | "action",
    title: string,
    body: string,
    email?: { subject: string; html: string },
    dedupMinutes = 60
  ) {
    // Insert in-app notification (deduped)
    const { data: notifId } = await supabase.rpc("insert_employee_notification", {
      p_employee_id: emp.id,
      p_type: type,
      p_severity: severity,
      p_title: title,
      p_body: body,
      p_action_url: "/time-tracker",
      p_payload: null,
      p_dedup_minutes: dedupMinutes,
    });

    if (!notifId) return false; // deduped

    // Email employee if we have one
    if (email && emp.email) {
      const sendResult = await sendEmail({
        to: [emp.email],
        subject: email.subject,
        html: email.html,
      });
      if (sendResult.ok) {
        results.emails_sent++;
        await supabase
          .from("employee_notifications")
          .update({ emailed_at: new Date().toISOString() })
          .eq("id", notifId);
      } else {
        results.emails_failed++;
        await supabase
          .from("employee_notifications")
          .update({ email_error: sendResult.error ?? null })
          .eq("id", notifId);
      }
    }
    return true;
  }

  for (const emp of employees as Employee[]) {
    const shift = shiftByEmployee.get(emp.id);
    const myEntries = entriesByEmployee.get(emp.id) ?? [];
    const hasRunning = myEntries.some((e) => e.status === "running");
    const hasAny = myEntries.length > 0;

    // Compute longest currently-running session duration (hours)
    const running = myEntries.find((e) => e.status === "running");
    let runningHours = 0;
    if (running) {
      runningHours =
        (now.getTime() - new Date(running.started_at).getTime()) / 1000 / 3600;
    }

    // --- AUTO-CLOSE: running session > threshold ---
    if (running && runningHours >= AUTO_CLOSE_HOURS) {
      // Close the session: set status='completed', ended_at=now, total_seconds accumulated
      const newTotal = Math.floor(runningHours * 3600);
      await supabase
        .from("time_entries")
        .update({
          status: "completed",
          ended_at: new Date().toISOString(),
          total_seconds: newTotal,
        })
        .eq("id", running.id);

      // Log
      await supabase.from("attendance_events").insert({
        employee_id: emp.id,
        time_entry_id: running.id,
        event_type: "auto_closed",
        details: { hours: runningHours, threshold_hours: AUTO_CLOSE_HOURS },
      });

      // Notify employee
      await notifyEmployee(
        emp,
        "auto_closed",
        "action",
        `Your session was auto-closed after ${runningHours.toFixed(1)}h`,
        `Your Time Tracker session was running for over ${AUTO_CLOSE_HOURS}h and was auto-closed. Add a correction if the end time was different.`,
        buildAutoCloseNotification({
          employeeName: emp.full_name,
          appUrl,
          hoursSoFar: runningHours,
          autoCloseHours: AUTO_CLOSE_HOURS,
        }),
        24 * 60
      );

      // Alert admins
      await insertAlert(supabase, {
        type: "autopilot_big_action",
        severity: "info",
        title: `${emp.full_name}'s session was auto-closed after ${runningHours.toFixed(1)}h`,
        body: `Time Tracker session ran past ${AUTO_CLOSE_HOURS}h without being stopped. Auto-close fired.`,
        resource_type: "system",
        resource_id: `auto_close:${emp.id}:${today}`,
        action_url: "/admin/attendance",
        payload: {
          employee_id: emp.id,
          employee_name: emp.full_name,
          hours: runningHours,
        },
        dedup_hours: 24,
      });

      results.auto_closed++;
      continue; // skip other rules for this employee
    }

    // Skip reminder logic for off days / unscheduled days
    if (!shift || shift.is_off_day) continue;
    if (!shift.start_time || !shift.end_time) continue;

    // --- CLOCK-IN REMINDER: past start + grace, not clocked in at all today ---
    const minsSinceStart = minutesSince(shift.start_time, currentTime);
    if (minsSinceStart >= CLOCKIN_GRACE_MIN && !hasAny) {
      const didSend = await notifyEmployee(
        emp,
        "clockin_reminder",
        "action",
        `You haven't clocked in yet`,
        `Your shift started at ${shift.start_time.slice(0, 5)}. Please clock in on the Time Tracker.`,
        buildClockinReminder({
          employeeName: emp.full_name,
          appUrl,
          startTime: shift.start_time.slice(0, 5),
        }),
        60
      );
      if (didSend) results.clockin_reminders++;
    }

    // --- BREAK REMINDER: running > 4 hours continuous (no pauses today) ---
    if (running && runningHours >= BREAK_AFTER_HOURS) {
      // Check if any pauses today
      const { data: pauses } = await supabase
        .from("time_pauses")
        .select("id")
        .eq("time_entry_id", running.id)
        .limit(1);
      if (!pauses || pauses.length === 0) {
        const didSend = await notifyEmployee(
          emp,
          "break_reminder",
          "info",
          `Time for a break?`,
          `You've been clocked in for ${runningHours.toFixed(1)}h without a pause.`,
          buildBreakReminder({
            employeeName: emp.full_name,
            appUrl,
            hoursSoFar: runningHours,
          }),
          2 * 60
        );
        if (didSend) results.break_reminders++;
      }
    }

    // --- CLOCKOUT REMINDER: past end + grace AND still running ---
    const minsSinceEnd = minutesSince(shift.end_time, currentTime);
    if (minsSinceEnd >= CLOCKOUT_GRACE_MIN && hasRunning) {
      const didSend = await notifyEmployee(
        emp,
        "clockout_reminder",
        "action",
        `Still working? Time to clock out`,
        `Your shift ended at ${shift.end_time.slice(0, 5)}. Stop the timer if you're done.`,
        buildClockoutReminder({
          employeeName: emp.full_name,
          appUrl,
          endTime: shift.end_time.slice(0, 5),
        }),
        2 * 60
      );
      if (didSend) results.clockout_reminders++;
    }
  }

  return Response.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}
