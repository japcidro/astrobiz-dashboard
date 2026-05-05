import { createServiceClient } from "@/lib/supabase/service";
import {
  syncAttemptFromVapi,
  mapStatus,
} from "@/lib/call-confirmer/sync";

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
    endedReason?: string;
    status?: string;
  };
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
  const { data: attempt } = await supabase
    .from("call_attempts")
    .select("id, store_id, is_test_call, status")
    .eq("provider_call_id", callId)
    .maybeSingle();

  if (!attempt) {
    console.warn(`[vapi-webhook] No attempt found for call_id=${callId}`);
    return Response.json({ ok: true, skipped: "attempt not found" });
  }

  const eventType = msg.type;

  // Status updates: light-touch update for live status. Don't poison
  // handoff_reason here — let the sync helper figure that out only when
  // the call has truly ended.
  if (eventType === "status-update") {
    const endedReason = msg.call?.endedReason ?? msg.endedReason;
    const newStatus = mapStatus(msg.call?.status ?? msg.status, endedReason);
    if (newStatus && newStatus !== attempt.status) {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === "in_progress" && !attempt.status.includes("progress")) {
        updates.started_at = new Date().toISOString();
      }
      await supabase.from("call_attempts").update(updates).eq("id", attempt.id);

      // If the call has ended (any terminal state), pull fresh authoritative
      // data from Vapi. This catches pipeline errors and successful endings
      // even if end-of-call-report fires late or never.
      const TERMINAL = new Set([
        "completed",
        "failed",
        "no_answer",
        "voicemail",
        "busy",
        "escalated",
      ]);
      if (TERMINAL.has(newStatus)) {
        await syncAttemptFromVapi(attempt.id, callId).catch((e) => {
          console.error(`[vapi-webhook] sync failed for ${attempt.id}:`, e);
        });
      }
    }
    return Response.json({ ok: true });
  }

  // End-of-call-report: full reconciliation via sync helper
  if (eventType === "end-of-call-report") {
    const result = await syncAttemptFromVapi(attempt.id, callId);
    return Response.json({ ok: true, sync: result });
  }

  return Response.json({ ok: true, skipped: `event type ${eventType}` });
}

// Vapi may verify URL is reachable
export async function GET() {
  return Response.json({ ok: true, service: "vapi-webhook" });
}
