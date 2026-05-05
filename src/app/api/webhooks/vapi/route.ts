import { createServiceClient } from "@/lib/supabase/service";
import type {
  CallStatus,
  CallOutcome,
  TranscriptTurn,
} from "@/lib/call-confirmer/types";

export const dynamic = "force-dynamic";

interface VapiWebhookPayload {
  message: {
    type: string;
    timestamp?: string;
    call?: {
      id?: string;
      status?: string;
      endedReason?: string;
      durationSeconds?: number;
      metadata?: Record<string, unknown>;
    };
    // Some events nest analysis/artifact at top of message instead of inside call
    analysis?: {
      summary?: string;
      structuredData?: Record<string, unknown>;
    };
    artifact?: {
      recordingUrl?: string;
      transcript?: string | TranscriptTurn[];
      messages?: { role: string; message?: string; content?: string }[];
    };
    summary?: string;
    transcript?: string | TranscriptTurn[];
    recordingUrl?: string;
    cost?: number;
    costs?: { llm?: number; voice?: number; transcriber?: number; vapi?: number };
    durationSeconds?: number;
    endedReason?: string;
    status?: string;
  };
}

// Map Vapi status / endedReason to our internal CallStatus
function mapStatus(
  vapiStatus: string | undefined,
  endedReason: string | undefined
): CallStatus | null {
  if (!vapiStatus && !endedReason) return null;

  // If call ended, derive from endedReason
  if (endedReason) {
    if (endedReason === "voicemail") return "voicemail";
    if (endedReason === "customer-did-not-answer" || endedReason === "no-answer")
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

  // Live status
  if (vapiStatus === "queued") return "queued";
  if (vapiStatus === "ringing") return "ringing";
  if (vapiStatus === "in-progress") return "in_progress";
  if (vapiStatus === "ended") return "completed";
  return null;
}

// Heuristic: derive outcome from AI summary + endedReason
function deriveOutcome(
  endedReason: string | undefined,
  summary: string | undefined
): { outcome: CallOutcome | null; needsVa: boolean; reason: string | null } {
  if (endedReason === "voicemail")
    return { outcome: "unreachable", needsVa: true, reason: "Hit voicemail" };
  if (endedReason === "customer-did-not-answer" || endedReason === "no-answer")
    return { outcome: "unreachable", needsVa: true, reason: "Did not answer" };
  if (endedReason === "customer-busy" || endedReason === "busy")
    return { outcome: "unreachable", needsVa: true, reason: "Line busy" };
  if (endedReason === "max-duration-exceeded")
    return {
      outcome: "needs_callback",
      needsVa: true,
      reason: "Call timed out at max duration",
    };

  if (!summary) return { outcome: null, needsVa: false, reason: null };

  const lower = summary.toLowerCase();
  if (lower.includes("escalat") || lower.includes("human") || lower.includes("support team"))
    return {
      outcome: "escalated_to_human",
      needsVa: true,
      reason: "AI escalated to human",
    };
  if (lower.includes("declin") || lower.includes("cancel") || lower.includes("did not order"))
    return { outcome: "declined", needsVa: false, reason: null };
  if (lower.includes("callback") || lower.includes("call back") || lower.includes("call later"))
    return { outcome: "needs_callback", needsVa: true, reason: "Customer requested callback" };
  if (lower.includes("confirm") || lower.includes("yes")) {
    return { outcome: "confirmed", needsVa: false, reason: null };
  }
  return { outcome: null, needsVa: false, reason: null };
}

function totalCost(
  costSingle: number | undefined,
  costs: VapiWebhookPayload["message"]["costs"]
): number {
  if (typeof costSingle === "number") return costSingle;
  if (!costs) return 0;
  return (
    (costs.llm ?? 0) +
    (costs.voice ?? 0) +
    (costs.transcriber ?? 0) +
    (costs.vapi ?? 0)
  );
}

type RawMessage = { role: string; message?: string; content?: string };

function normalizeTranscript(
  transcript: VapiWebhookPayload["message"]["transcript"],
  messages: RawMessage[] | undefined
): TranscriptTurn[] | null {
  if (Array.isArray(transcript)) return transcript;
  if (Array.isArray(messages)) {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "bot")
      .map((m) => ({
        role: m.role === "bot" ? "assistant" : (m.role as "user" | "assistant"),
        message: m.message ?? m.content ?? "",
      }));
  }
  return null;
}

export async function POST(req: Request) {
  // 1. Verify the webhook came from Vapi
  const expectedSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return Response.json(
      { error: "VAPI_WEBHOOK_SECRET not configured" },
      { status: 500 }
    );
  }
  const provided = req.headers.get("x-vapi-secret");
  if (provided !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: VapiWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const msg = payload.message;
  if (!msg) return Response.json({ ok: true, skipped: "no message" });

  const callId = msg.call?.id;
  if (!callId) {
    return Response.json({ ok: true, skipped: "no call id" });
  }

  const supabase = createServiceClient();

  // Find our attempt by provider_call_id
  const { data: attempt } = await supabase
    .from("call_attempts")
    .select("id, store_id, is_test_call, status")
    .eq("provider_call_id", callId)
    .maybeSingle();

  if (!attempt) {
    // Could be a stale call or one we didn't initiate — log and ack
    console.warn(`[vapi-webhook] No attempt found for call_id=${callId}`);
    return Response.json({ ok: true, skipped: "attempt not found" });
  }

  const eventType = msg.type;

  // Status updates: keep status fresh
  if (eventType === "status-update") {
    const endedReason = msg.call?.endedReason ?? msg.endedReason;
    const newStatus = mapStatus(msg.call?.status ?? msg.status, endedReason);
    if (newStatus && newStatus !== attempt.status) {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === "in_progress" && !attempt.status.includes("progress")) {
        updates.started_at = new Date().toISOString();
      }
      // If call ended via status-update (e.g. pipeline errors that skip
      // end-of-call-report), record the reason + ended_at so the UI can
      // show what actually broke instead of a bare "FAILED".
      const TERMINAL = new Set([
        "completed",
        "failed",
        "no_answer",
        "voicemail",
        "busy",
        "escalated",
      ]);
      if (TERMINAL.has(newStatus)) {
        updates.ended_at = new Date().toISOString();
        if (endedReason) {
          updates.handoff_reason = `Vapi: ${endedReason}`;
        }
      }
      await supabase
        .from("call_attempts")
        .update(updates)
        .eq("id", attempt.id);
    }
    return Response.json({ ok: true });
  }

  // End-of-call-report: the big one — write final state
  if (eventType === "end-of-call-report") {
    const summary =
      msg.analysis?.summary ?? msg.summary ?? null;
    const transcript = normalizeTranscript(
      msg.artifact?.transcript ?? msg.transcript,
      msg.artifact?.messages
    );
    const recordingUrl =
      msg.artifact?.recordingUrl ?? msg.recordingUrl ?? null;
    const cost = totalCost(msg.cost, msg.costs);
    const duration =
      msg.call?.durationSeconds ?? msg.durationSeconds ?? 0;
    const endedReason = msg.call?.endedReason ?? msg.endedReason;

    const status = mapStatus(undefined, endedReason) ?? "completed";
    const { outcome, needsVa, reason } = deriveOutcome(endedReason, summary ?? undefined);

    // Always capture endedReason in handoff_reason if no other reason set,
    // so failed pipeline errors (e.g. voice-not-found) surface in the UI.
    const finalReason =
      reason ??
      (status === "failed" && endedReason
        ? `Vapi: ${endedReason}`
        : null);

    await supabase
      .from("call_attempts")
      .update({
        status,
        outcome,
        ai_summary: summary,
        transcript,
        recording_url: recordingUrl,
        duration_seconds: duration,
        cost_usd: cost,
        needs_va_followup: needsVa,
        handoff_reason: finalReason,
        ended_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    // Increment daily spend rollup
    if (cost > 0 || duration > 0) {
      await supabase.rpc("increment_call_spend", {
        p_store_id: attempt.store_id,
        p_seconds: Math.round(duration),
        p_cost_usd: cost,
        p_is_test: attempt.is_test_call,
      });
    }

    return Response.json({ ok: true });
  }

  // Other event types: ack and ignore for now
  return Response.json({ ok: true, skipped: `event type ${eventType}` });
}

// Vapi may also call HEAD/GET to verify the URL is reachable
export async function GET() {
  return Response.json({ ok: true, service: "vapi-webhook" });
}
