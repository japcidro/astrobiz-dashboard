import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/resend";
import { buildDigestEmail } from "@/lib/email/templates";
import { getAdminEmails } from "@/lib/email/admin-recipients";
import type { AdminAlert } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Scheduled daily 9 AM PHT = 1 AM UTC (see vercel.json).
// Sends all action + info alerts from the past 24h that haven't been
// included in a digest yet. Urgent alerts are already emailed immediately
// by detect-alerts, but if any slipped through (email failure), they're
// included here too.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? baseUrl;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("admin_alerts")
    .select("*")
    .gte("created_at", since)
    .is("digest_included_at", null)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

  const alerts = (data ?? []) as AdminAlert[];
  if (alerts.length === 0) {
    return Response.json({ success: true, sent: 0, reason: "nothing new" });
  }

  const recipients = await getAdminEmails(supabase);
  const { subject, html } = buildDigestEmail(alerts, appUrl);

  const sendResult = await sendEmail({ to: recipients, subject, html });
  if (!sendResult.ok) {
    return Response.json(
      { success: false, error: sendResult.error, attempted: alerts.length },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();
  await supabase
    .from("admin_alerts")
    .update({ digest_included_at: now })
    .in(
      "id",
      alerts.map((a) => a.id)
    );

  return Response.json({
    success: true,
    sent: alerts.length,
    recipients: recipients.length,
    email_id: sendResult.id,
  });
}
