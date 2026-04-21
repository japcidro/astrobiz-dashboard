import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefingType, PeriodRange } from "./types";
import { getPeriod, phtDateString } from "./period";
import { collectBriefingData } from "./collect";
import { generateAISummary } from "./summarize";
import { buildBriefingEmail } from "./email-template";
import { sendEmail } from "@/lib/email/resend";
import { getAdminEmails } from "@/lib/email/admin-recipients";

function formatPHP(n: number): string {
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

interface RunOptions {
  // Skip email on backfill reruns — we don't want admins getting yesterday's
  // report re-delivered in their inbox every time someone clicks Rebuild.
  skipEmail?: boolean;
  // Override the period — used by the backfill endpoint when rebuilding a
  // historical briefing. Falls back to getPeriod(type) (the "current" period).
  period?: PeriodRange;
}

export async function runBriefing(
  supabase: SupabaseClient,
  baseUrl: string,
  cronSecret: string,
  type: BriefingType,
  options: RunOptions = {}
): Promise<{
  success: boolean;
  briefing_id?: string;
  email?: { sent: number; error?: string };
  error?: string;
}> {
  const period = options.period ?? getPeriod(type);
  const periodStart = phtDateString(period.start);
  const periodEnd = phtDateString(period.end);

  // Idempotency: if we already have a briefing for this (type, start, end),
  // skip collection and reuse it.
  const { data: existing } = await supabase
    .from("briefings")
    .select("id")
    .eq("type", type)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existing?.id) {
    return { success: true, briefing_id: existing.id, email: { sent: 0, error: "already exists" } };
  }

  // 1. Collect data
  let data;
  try {
    data = await collectBriefingData(supabase, baseUrl, cronSecret, type, period);
  } catch (err) {
    return {
      success: false,
      error: `data collection failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // 2. AI summary (non-blocking if it fails)
  const aiSummary = await generateAISummary(supabase, type, period.label, data);

  // 3. Build headline
  const headline = `${formatPHP(data.revenue)} revenue · ${data.orders} orders · ${data.roas.toFixed(2)}x ROAS`;

  // 4. Save briefing row
  const { data: inserted, error: insertErr } = await supabase
    .from("briefings")
    .insert({
      type,
      period_label: period.label,
      period_start: periodStart,
      period_end: periodEnd,
      headline,
      ai_summary: aiSummary,
      data,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      success: false,
      error: `insert failed: ${insertErr?.message ?? "unknown"}`,
    };
  }

  const briefingId = inserted.id as string;

  if (options.skipEmail) {
    return {
      success: true,
      briefing_id: briefingId,
      email: { sent: 0, error: "skipped" },
    };
  }

  // 5. Send email
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? baseUrl;
  const recipients = await getAdminEmails(supabase);
  const { subject, html } = buildBriefingEmail(
    type,
    period.label,
    data,
    aiSummary,
    appUrl,
    briefingId
  );

  const sendResult = await sendEmail({ to: recipients, subject, html });

  if (sendResult.ok) {
    await supabase
      .from("briefings")
      .update({
        email_sent_at: new Date().toISOString(),
        email_recipients: recipients.length,
        email_id: sendResult.id ?? null,
      })
      .eq("id", briefingId);
    return {
      success: true,
      briefing_id: briefingId,
      email: { sent: recipients.length },
    };
  }

  await supabase
    .from("briefings")
    .update({ email_error: sendResult.error ?? null })
    .eq("id", briefingId);

  return {
    success: true,
    briefing_id: briefingId,
    email: { sent: 0, error: sendResult.error },
  };
}
