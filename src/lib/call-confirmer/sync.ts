import { createServiceClient } from "@/lib/supabase/service";
import { getVapiCall } from "./vapi";
import type {
  CallStatus,
  CallOutcome,
  TranscriptTurn,
} from "./types";

const TERMINAL_STATUSES = new Set<CallStatus>([
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "escalated",
]);

const ERROR_ENDED_REASONS = new Set([
  "twilio-failed",
  "pipeline-error-eleven-labs-voice-not-found",
  "pipeline-error-openai-llm-failed",
  "pipeline-error-deepgram-transcriber-failed",
  "assistant-error",
  "exceeded-max-duration",
  "max-duration-exceeded",
]);

/** Map Vapi status / endedReason → our CallStatus. */
export function mapStatus(
  vapiStatus: string | undefined,
  endedReason: string | undefined
): CallStatus | null {
  if (!vapiStatus && !endedReason) return null;

  if (endedReason) {
    if (endedReason === "voicemail") return "voicemail";
    if (
      endedReason === "customer-did-not-answer" ||
      endedReason === "no-answer"
    )
      return "no_answer";
    if (endedReason === "customer-busy" || endedReason === "busy") return "busy";
    if (
      endedReason === "twilio-failed" ||
      endedReason.includes("error") ||
      endedReason.includes("failed")
    )
      return "failed";
    return "completed";
  }

  if (vapiStatus === "queued") return "queued";
  if (vapiStatus === "ringing") return "ringing";
  if (vapiStatus === "in-progress") return "in_progress";
  if (vapiStatus === "ended") return "completed";
  return null;
}

/** Derive our outcome + VA-followup signal from Vapi data. */
export function deriveOutcome(
  endedReason: string | undefined,
  summary: string | undefined,
  successEvaluation: string | undefined
): { outcome: CallOutcome | null; needsVa: boolean; reason: string | null } {
  if (endedReason === "voicemail")
    return { outcome: "unreachable", needsVa: true, reason: "Hit voicemail" };
  if (endedReason === "customer-did-not-answer" || endedReason === "no-answer")
    return { outcome: "unreachable", needsVa: true, reason: "Did not answer" };
  if (endedReason === "customer-busy" || endedReason === "busy")
    return { outcome: "unreachable", needsVa: true, reason: "Line busy" };
  if (endedReason === "max-duration-exceeded" || endedReason === "exceeded-max-duration")
    return {
      outcome: "needs_callback",
      needsVa: true,
      reason: "Call timed out at max duration",
    };

  // Vapi's success evaluation: "true" is a strong confirm signal.
  // "false" does NOT necessarily mean declined — could be silence, hangup,
  // unclear customer response, etc. So we only trust "true" here and let
  // summary parsing handle the rest.
  if (successEvaluation === "true" || successEvaluation === "yes") {
    return { outcome: "confirmed", needsVa: false, reason: null };
  }

  if (!summary) return { outcome: null, needsVa: false, reason: null };

  const lower = summary.toLowerCase();

  // 1) Silence / hangup / no response → unreachable (NOT declined)
  if (
    lower.includes("silence") ||
    lower.includes("did not respond") ||
    lower.includes("no response") ||
    lower.includes("hung up") ||
    lower.includes("dropped") ||
    lower.includes("disconnected")
  ) {
    return {
      outcome: "unreachable",
      needsVa: true,
      reason: "Call ended without customer response",
    };
  }

  // 2) Strong confirmation phrases (check BEFORE generic decline to avoid
  //    false positives like "user did not decline → confirmed").
  if (
    lower.includes("user accepted") ||
    lower.includes("customer accepted") ||
    lower.includes("user confirmed") ||
    lower.includes("customer confirmed") ||
    lower.includes("user agreed") ||
    lower.includes("customer agreed") ||
    lower.includes("user said yes") ||
    lower.includes("customer said yes") ||
    lower.includes("confirmed the order") ||
    lower.includes("order was confirmed") ||
    lower.includes("order is confirmed")
  ) {
    return { outcome: "confirmed", needsVa: false, reason: null };
  }

  // 3) Explicit decline phrases (very strict — only if summary clearly says
  //    customer rejected the order, not just any mention of "decline")
  if (
    lower.includes("user declined") ||
    lower.includes("customer declined") ||
    lower.includes("user rejected") ||
    lower.includes("customer rejected") ||
    lower.includes("user cancel") ||
    lower.includes("customer cancel") ||
    lower.includes("user did not want") ||
    lower.includes("customer did not want") ||
    lower.includes("did not place") ||
    lower.includes("user said no") ||
    lower.includes("customer said no") ||
    lower.includes("did not order")
  ) {
    return { outcome: "declined", needsVa: false, reason: null };
  }

  // 4) Escalation / team handoff (Maria deferred a question to support team)
  if (
    lower.includes("escalat") ||
    lower.includes("transfer to") ||
    lower.includes("support team") ||
    lower.includes("team will") ||
    lower.includes("team to") ||
    lower.includes("ipapasa") ||
    lower.includes("connect them with") ||
    lower.includes("connecting them with") ||
    lower.includes("offered to connect") ||
    lower.includes("offered connecting") ||
    lower.includes("team to resolve") ||
    lower.includes("resolve concerns") ||
    lower.includes("team to handle") ||
    lower.includes("team to follow")
  ) {
    return {
      outcome: "escalated_to_human",
      needsVa: true,
      // Use the FIRST SENTENCE of the summary as the reason — gives VA
      // actual context ("user questioned the address", etc) instead of
      // a useless generic label.
      reason: extractFirstSentence(summary),
    };
  }

  // 5) Callback request
  if (
    lower.includes("callback") ||
    lower.includes("call back") ||
    lower.includes("call later") ||
    lower.includes("call again")
  ) {
    return {
      outcome: "needs_callback",
      needsVa: true,
      reason: extractFirstSentence(summary),
    };
  }

  // No clear signal — surface the AI summary itself as the handoff_reason
  // so the VA has CONTEXT, not just a useless "Outcome unclear" label.
  return {
    outcome: null,
    needsVa: true,
    reason: extractFirstSentence(summary),
  };
}

/**
 * Pull the most informative sentence from an AI summary for VA context.
 * Prefers sentences that mention the customer's question or concern.
 */
function extractFirstSentence(summary: string): string {
  // Try to find a sentence that mentions what the customer asked/said
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Prefer the sentence that mentions customer concern/question/issue
  const concernKeywords = [
    "user asked",
    "customer asked",
    "user questioned",
    "customer questioned",
    "user wanted",
    "customer wanted",
    "user requested",
    "customer requested",
    "user inquired",
    "concern",
    "issue",
    "problem",
    "complaint",
  ];
  for (const s of sentences) {
    const sl = s.toLowerCase();
    if (concernKeywords.some((k) => sl.includes(k))) {
      return s.length > 220 ? s.slice(0, 217) + "..." : s;
    }
  }

  // Otherwise return the first non-trivial sentence
  const first = sentences[0] ?? summary;
  return first.length > 220 ? first.slice(0, 217) + "..." : first;
}

export function normalizeTranscript(
  transcript: string | TranscriptTurn[] | undefined,
  messages: { role: string; message?: string; content?: string }[] | undefined
): TranscriptTurn[] | null {
  if (Array.isArray(transcript)) return transcript;
  if (Array.isArray(messages)) {
    return messages
      .filter((m) =>
        m.role === "user" || m.role === "assistant" || m.role === "bot"
      )
      .map((m) => ({
        role: m.role === "bot" ? ("assistant" as const) : (m.role as "user" | "assistant"),
        message: m.message ?? m.content ?? "",
      }))
      .filter((t) => t.message.trim().length > 0);
  }
  return null;
}

/** Compute total cost from a Vapi cost breakdown or single cost. */
export function totalCost(
  costSingle: number | undefined,
  costs: { llm?: number; voice?: number; transcriber?: number; vapi?: number; total?: number; tts?: number; stt?: number; transport?: number } | undefined
): number {
  if (typeof costs?.total === "number") return costs.total;
  if (typeof costSingle === "number") return costSingle;
  if (!costs) return 0;
  return (
    (costs.llm ?? 0) +
    (costs.voice ?? 0) +
    (costs.tts ?? 0) +
    (costs.transcriber ?? 0) +
    (costs.stt ?? 0) +
    (costs.vapi ?? 0) +
    (costs.transport ?? 0)
  );
}

/**
 * Pull fresh call data from Vapi and reconcile our DB row.
 * This is our defensive sync — webhook is preferred but Vapi is source of truth.
 * Safe to call repeatedly; will only update fields that are stale or missing.
 */
export async function syncAttemptFromVapi(
  attemptId: string,
  providerCallId: string
): Promise<{ updated: boolean; status: CallStatus | null; error?: string }> {
  let vapiCall;
  try {
    vapiCall = await getVapiCall(providerCallId);
  } catch (e: unknown) {
    return {
      updated: false,
      status: null,
      error: e instanceof Error ? e.message : "Vapi fetch failed",
    };
  }

  // Vapi call shape includes top-level cost (number) + costBreakdown (object)
  const rawCost = (vapiCall as unknown as { cost?: number }).cost;
  const costBreakdown = (vapiCall as unknown as {
    costBreakdown?: { total?: number; llm?: number; tts?: number; stt?: number; vapi?: number; transport?: number };
  }).costBreakdown;
  const cost = totalCost(rawCost, costBreakdown);

  const startedAt = vapiCall.startedAt ? new Date(vapiCall.startedAt) : null;
  const endedAt = vapiCall.endedAt ? new Date(vapiCall.endedAt) : null;
  const duration =
    startedAt && endedAt
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null;

  const summary = vapiCall.analysis?.summary ?? null;
  const successEvaluation = vapiCall.analysis?.successEvaluation;
  const transcript = normalizeTranscript(
    vapiCall.artifact?.transcript ?? vapiCall.transcript,
    vapiCall.artifact?.messages ?? vapiCall.messages
  );
  const recordingUrl =
    vapiCall.artifact?.recordingUrl ?? vapiCall.recordingUrl ?? null;
  const endedReason = vapiCall.endedReason;

  const status =
    mapStatus(vapiCall.status, endedReason) ?? "completed";
  const { outcome, needsVa, reason } = deriveOutcome(
    endedReason,
    summary ?? undefined,
    successEvaluation
  );

  // Only flag as handoff reason if it's a real error, not a clean ending
  const finalReason =
    reason ??
    (endedReason && ERROR_ENDED_REASONS.has(endedReason)
      ? `Vapi: ${endedReason}`
      : null);

  const supabase = createServiceClient();

  const updates: Record<string, unknown> = {
    status,
    outcome,
    ai_summary: summary,
    transcript,
    recording_url: recordingUrl,
    needs_va_followup: needsVa,
    handoff_reason: finalReason,
  };
  if (duration != null) updates.duration_seconds = duration;
  if (cost > 0) updates.cost_usd = cost;
  if (startedAt) updates.started_at = startedAt.toISOString();
  if (endedAt && TERMINAL_STATUSES.has(status))
    updates.ended_at = endedAt.toISOString();

  // Also fetch attempt to know store_id + is_test_call for spend rollup
  const { data: existing } = await supabase
    .from("call_attempts")
    .select("store_id, is_test_call, cost_usd, duration_seconds")
    .eq("id", attemptId)
    .maybeSingle();

  await supabase
    .from("call_attempts")
    .update(updates)
    .eq("id", attemptId);

  // Increment spend rollup only for the delta (so repeat syncs don't double-count)
  if (existing && TERMINAL_STATUSES.has(status)) {
    const prevCost = Number(existing.cost_usd ?? 0);
    const prevDuration = existing.duration_seconds ?? 0;
    const costDelta = cost - prevCost;
    const durationDelta = (duration ?? 0) - prevDuration;
    if (costDelta > 0 || durationDelta > 0) {
      await supabase.rpc("increment_call_spend", {
        p_store_id: existing.store_id,
        p_seconds: Math.max(0, Math.round(durationDelta)),
        p_cost_usd: Math.max(0, costDelta),
        p_is_test: existing.is_test_call,
      });
    }
  }

  return { updated: true, status };
}
