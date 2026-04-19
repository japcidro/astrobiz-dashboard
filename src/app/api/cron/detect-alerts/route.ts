import { createServiceClient } from "@/lib/supabase/service";
import {
  detectStockRestockedWinner,
  detectStockDepletingWinner,
} from "@/lib/alerts/rules/stock";
import { detectNewWinners } from "@/lib/alerts/rules/winners";
import {
  detectAutopilotBigAction,
  detectRtsSpike,
  detectCashAtRisk,
  detectStoreOutage,
} from "@/lib/alerts/rules/operations";
import { sendEmail } from "@/lib/email/resend";
import { buildUrgentEmail } from "@/lib/email/templates";
import { getAdminEmails } from "@/lib/email/admin-recipients";
import type { AdminAlert } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Runs every 30 min (see vercel.json). Checks all 7 rules and inserts
// any new alerts. Dedup is handled inside each rule via insert_admin_alert.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cronSecret = process.env.CRON_SECRET!;
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const startTime = Date.now();

  const results: Record<string, number | string> = {};

  const rules: Array<[string, () => Promise<number>]> = [
    ["stock_restocked_winner", () => detectStockRestockedWinner(supabase)],
    ["stock_depleting_winner", () => detectStockDepletingWinner(supabase)],
    ["new_winner", () => detectNewWinners(supabase, baseUrl, cronSecret)],
    ["autopilot_big_action", () => detectAutopilotBigAction(supabase)],
    ["rts_spike", () => detectRtsSpike(supabase)],
    ["cash_at_risk", () => detectCashAtRisk(supabase)],
    ["store_outage", () => detectStoreOutage(supabase, baseUrl, cronSecret)],
  ];

  for (const [name, runner] of rules) {
    try {
      const count = await runner();
      results[name] = count;
    } catch (err) {
      results[name] = `error: ${err instanceof Error ? err.message : "unknown"}`;
      console.error(`[detect-alerts] ${name} failed:`, err);
    }
  }

  // Flush pending urgent alerts via email (immediate delivery).
  let emailStatus: Record<string, unknown> = { skipped: true };
  try {
    const { data: pending } = await supabase
      .from("admin_alerts")
      .select("*")
      .eq("severity", "urgent")
      .is("emailed_at", null)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const pendingAlerts = (pending ?? []) as AdminAlert[];
    if (pendingAlerts.length > 0) {
      const recipients = await getAdminEmails(supabase);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? baseUrl;
      const { subject, html } = buildUrgentEmail(pendingAlerts, appUrl);
      const sendResult = await sendEmail({ to: recipients, subject, html });
      if (sendResult.ok) {
        const ids = pendingAlerts.map((a) => a.id);
        await supabase
          .from("admin_alerts")
          .update({ emailed_at: new Date().toISOString() })
          .in("id", ids);
        emailStatus = { sent: pendingAlerts.length, recipients: recipients.length };
      } else {
        emailStatus = { error: sendResult.error, pending: pendingAlerts.length };
      }
    } else {
      emailStatus = { skipped: true, reason: "no pending urgent alerts" };
    }
  } catch (err) {
    emailStatus = { error: err instanceof Error ? err.message : "unknown" };
  }

  return Response.json({
    success: true,
    results,
    email: emailStatus,
    duration_seconds: Math.round((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
}
