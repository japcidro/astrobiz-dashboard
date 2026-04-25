import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BriefingData,
  BriefingType,
  PeriodRange,
  FetchError,
  FetchSource,
} from "./types";
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
  // Skip email entirely (used by manual backfill — admins don't want yesterday's
  // report re-delivered just because someone clicked Rebuild).
  skipEmail?: boolean;
  // Override the period — used by the backfill endpoint when rebuilding a
  // historical briefing. Falls back to getPeriod(type) (the "current" period).
  period?: PeriodRange;
}

export interface RunResult {
  success: boolean;
  briefing_id?: string;
  email?: { sent: number; error?: string };
  error?: string;
  fetch_errors?: FetchError[];
  // True if we updated a previously-bad row instead of inserting fresh.
  updated?: boolean;
}

const CRITICAL_SOURCES: readonly FetchSource[] = ["pnl", "ads", "orders"];

function isFullyZero(data: BriefingData | null | undefined): boolean {
  if (!data) return true;
  return (data.revenue ?? 0) === 0
    && (data.orders ?? 0) === 0
    && (data.ad_spend ?? 0) === 0;
}

// "Healthy" = clean data with no fetch errors. We use this both as the
// idempotency short-circuit (don't re-collect a good row) and as the gate
// for sending email (don't email until we have real numbers).
function isHealthy(
  data: BriefingData | null | undefined,
  errors: FetchError[]
): boolean {
  if (!data) return false;
  if (errors.length > 0) return false;
  if (isFullyZero(data)) return false;
  return true;
}

export async function runBriefing(
  supabase: SupabaseClient,
  baseUrl: string,
  cronSecret: string,
  type: BriefingType,
  options: RunOptions = {}
): Promise<RunResult> {
  const period = options.period ?? getPeriod(type);
  const periodStart = phtDateString(period.start);
  const periodEnd = phtDateString(period.end);

  // Look up existing row by (type, period_start, period_end). Three cases:
  //   1. No row → fresh attempt. If collect fails, don't insert (let cron retry).
  //   2. Row exists, healthy → idempotency short-circuit, do nothing.
  //   3. Row exists, bad (zeros or fetch errors) → re-collect, update if better.
  const { data: existing } = await supabase
    .from("briefings")
    .select("id, data, fetch_errors, retry_count, email_sent_at, period_label")
    .eq("type", type)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  const existingData = (existing?.data as BriefingData | null) ?? null;
  const existingErrors = (existing?.fetch_errors as FetchError[] | null) ?? [];

  if (existing && isHealthy(existingData, existingErrors)) {
    return {
      success: true,
      briefing_id: existing.id,
      email: { sent: 0, error: "already exists" },
    };
  }

  // Collect fresh data.
  let collected;
  try {
    collected = await collectBriefingData(supabase, baseUrl, cronSecret, type, period);
  } catch (err) {
    if (existing) {
      await supabase
        .from("briefings")
        .update({
          retry_count: (existing.retry_count ?? 0) + 1,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return {
      success: false,
      error: `data collection threw: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  const { data, fetchErrors } = collected;

  // We always save a row for the period so the retry cron has something
  // to find and the dashboard shows a clear "Retrying" entry instead of
  // a missing one. The email gate further down is what stops the bad
  // ₱0/0/0 message from going out.
  //
  // Skip the AI summary when data is dead-zero — feeding Claude an empty
  // payload wastes tokens and produces hallucinated narratives like
  // "Saturday Zero: Complete System Pause" that the user has no way to
  // distinguish from real reports.
  const skipAi = isFullyZero(data) || fetchErrors.some((e) => CRITICAL_SOURCES.includes(e.source));
  const aiSummary = skipAi
    ? null
    : await generateAISummary(supabase, type, period.label, data);

  // Headline tells the dashboard at a glance whether this row is final
  // or still being retried. Without this, a tubol "₱0 revenue" headline
  // is indistinguishable from a real zero-activity day.
  const failedSources = fetchErrors.map((e) => e.source).join(", ");
  let headline: string;
  if (isFullyZero(data) && fetchErrors.length > 0) {
    headline = `Retrying · ${failedSources} fetch failed`;
  } else if (fetchErrors.length > 0) {
    headline = `${formatPHP(data.revenue)} revenue · ${data.orders} orders · ${data.roas.toFixed(2)}x ROAS · partial (${failedSources})`;
  } else {
    headline = `${formatPHP(data.revenue)} revenue · ${data.orders} orders · ${data.roas.toFixed(2)}x ROAS`;
  }
  const nowIso = new Date().toISOString();

  let briefingId: string;
  let isUpdate = false;

  if (existing) {
    const { error: updateErr } = await supabase
      .from("briefings")
      .update({
        period_label: period.label,
        headline,
        ai_summary: aiSummary,
        data,
        fetch_errors: fetchErrors,
        retry_count: (existing.retry_count ?? 0) + 1,
        last_retry_at: nowIso,
      })
      .eq("id", existing.id);
    if (updateErr) {
      return { success: false, error: `update failed: ${updateErr.message}` };
    }
    briefingId = existing.id;
    isUpdate = true;
  } else {
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
        fetch_errors: fetchErrors,
        retry_count: 0,
        last_retry_at: null,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return { success: false, error: `insert failed: ${insertErr?.message ?? "unknown"}` };
    }
    briefingId = inserted.id as string;
  }

  if (options.skipEmail) {
    return {
      success: true,
      briefing_id: briefingId,
      email: { sent: 0, error: "skipped" },
      fetch_errors: fetchErrors,
      updated: isUpdate,
    };
  }

  // Email gate: only send when the briefing actually has clean data.
  // Sending a "₱0 / 0 orders / 0.00x ROAS" email at 6 AM and then a
  // corrected one 30 min later is exactly the noise this rewrite is
  // meant to eliminate.
  if (fetchErrors.length > 0 || isFullyZero(data)) {
    return {
      success: true,
      briefing_id: briefingId,
      email: {
        sent: 0,
        error:
          fetchErrors.length > 0
            ? "skipped: fetch errors (retry pending)"
            : "skipped: zero data",
      },
      fetch_errors: fetchErrors,
      updated: isUpdate,
    };
  }

  // If we're updating a row that was previously emailed with bad data,
  // prefix the subject so admins notice it's a corrected version.
  const wasPreviouslyEmailed = isUpdate && !!existing?.email_sent_at;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? baseUrl;
  const recipients = await getAdminEmails(supabase);
  const built = buildBriefingEmail(
    type,
    period.label,
    data,
    aiSummary,
    appUrl,
    briefingId
  );
  const subject = wasPreviouslyEmailed ? `[Updated] ${built.subject}` : built.subject;

  const sendResult = await sendEmail({ to: recipients, subject, html: built.html });

  if (sendResult.ok) {
    await supabase
      .from("briefings")
      .update({
        email_sent_at: nowIso,
        email_recipients: recipients.length,
        email_id: sendResult.id ?? null,
        email_error: null,
      })
      .eq("id", briefingId);
    return {
      success: true,
      briefing_id: briefingId,
      email: { sent: recipients.length },
      fetch_errors: fetchErrors,
      updated: isUpdate,
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
    fetch_errors: fetchErrors,
    updated: isUpdate,
  };
}
