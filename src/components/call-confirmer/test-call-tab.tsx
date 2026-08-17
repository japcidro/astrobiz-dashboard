"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  PhoneCall,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type {
  CallConfirmerConfig,
  CallAttempt,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import type { OrderContext } from "@/lib/call-confirmer/assistant";
import { normalizePhPhone } from "@/lib/call-confirmer/phone";
import { StoreSelector } from "./store-selector";

interface Props {
  stores: ShopifyStoreLite[];
  configs: CallConfirmerConfig[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  employeeId: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  voicemail: "Hit voicemail",
  busy: "Line busy",
  escalated: "Escalated",
};

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-gray-700 text-gray-200",
  ringing: "bg-blue-700 text-blue-100",
  in_progress: "bg-emerald-700 text-emerald-100",
  completed: "bg-emerald-600 text-white",
  failed: "bg-red-700 text-red-100",
  no_answer: "bg-yellow-700 text-yellow-100",
  voicemail: "bg-yellow-700 text-yellow-100",
  busy: "bg-yellow-700 text-yellow-100",
  escalated: "bg-orange-700 text-orange-100",
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "escalated",
]);

export function TestCallTab({
  stores,
  configs,
  selectedStoreId,
  onStoreChange,
}: Props) {
  const config = configs.find((c) => c.store_id === selectedStoreId);
  const enabled = !!config?.enabled;
  const ready = !!config?.voice_id && enabled;

  const [phone, setPhone] = useState("");
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<CallAttempt | null>(null);
  const [sampleOrder, setSampleOrder] = useState<OrderContext | null>(null);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const loadSampleOrder = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoadingSample(true);
    setSampleNote(null);
    try {
      const res = await fetch(
        `/api/admin/call-confirmer/sample-order?store_id=${selectedStoreId}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sample");
      setSampleOrder(data.order);
      setSampleNote(data.reason ?? null);
    } catch (e: unknown) {
      setSampleOrder(null);
      setSampleNote(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingSample(false);
    }
  }, [selectedStoreId]);

  // Reset state when changing store + load fresh sample
  useEffect(() => {
    setAttemptId(null);
    setAttempt(null);
    setError(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    loadSampleOrder();
  }, [selectedStoreId, loadSampleOrder]);

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let extraPostTerminalPolls = 0;
    const MAX_POST_TERMINAL_POLLS = 8; // ~24s grace for late webhook delivery

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/admin/call-confirmer/attempts/${id}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Poll failed");
        setAttempt(data.attempt);

        // After hitting terminal status, keep polling a few more times so the
        // end-of-call-report webhook (which delivers transcript + recording +
        // summary) has time to land. Stop early if we already have transcript.
        if (TERMINAL_STATUSES.has(data.attempt.status)) {
          const hasFullData =
            data.attempt.transcript !== null &&
            data.attempt.recording_url &&
            data.attempt.cost_usd !== null;

          if (hasFullData || extraPostTerminalPolls >= MAX_POST_TERMINAL_POLLS) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } else {
            extraPostTerminalPolls += 1;
          }
        }
      } catch {
        // Don't kill polling on transient errors
      }
    }, 3000);
  };

  const refreshAttempt = async () => {
    if (!attemptId) return;
    try {
      const res = await fetch(
        `/api/admin/call-confirmer/attempts/${attemptId}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setAttempt(data.attempt);
    } catch {
      /* swallow */
    }
  };

  const handleCall = async () => {
    setError(null);
    // Typed however is natural ("09171234567"); Twilio needs E.164.
    const e164 = normalizePhPhone(phone);
    if (!e164) {
      setError("Hindi valid ang number. Halimbawa: 09171234567");
      return;
    }
    setInitiating(true);
    setAttempt(null);
    setAttemptId(null);

    try {
      const res = await fetch("/api/admin/call-confirmer/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId,
          customer_phone: e164,
          is_test_call: true,
          order: sampleOrder ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to initiate");
      setAttemptId(data.attempt_id);
      startPolling(data.attempt_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to initiate call");
    } finally {
      setInitiating(false);
    }
  };

  const isTerminal = attempt && TERMINAL_STATUSES.has(attempt.status);
  const normalizedPhone = normalizePhPhone(phone);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <StoreSelector
          stores={stores}
          value={selectedStoreId}
          onChange={onStoreChange}
        />
      </div>

      {!enabled && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-6">
          <p className="text-yellow-200 font-medium mb-1">
            Call Confirmer is disabled for this store
          </p>
          <p className="text-sm text-yellow-300/80">
            Pumunta sa <strong>Settings</strong> tab → toggle on at i-save.
          </p>
        </div>
      )}

      {enabled && !ready && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-6">
          <p className="text-yellow-200 font-medium mb-1">Setup incomplete</p>
          <p className="text-sm text-yellow-300/80">
            Pumili ng voice + i-set ang support phone sa Settings tab muna.
          </p>
        </div>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h3 className="text-white font-medium mb-1">Test Call</h3>
        <p className="text-sm text-gray-500 mb-4">
          Tatawagin ka ng AI gamit ang real order data from your Shopify store
          — para parang totoong customer call. Cost: ~$0.20–0.35 per call.
          Counted separately from store budget.
        </p>

        <div className="bg-gray-900/40 border border-gray-700/40 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              Sample order Maria will read:
            </p>
            <button
              type="button"
              onClick={loadSampleOrder}
              disabled={loadingSample}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Pull a different recent order"
            >
              {loadingSample ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh
            </button>
          </div>

          {loadingSample && !sampleOrder ? (
            <div className="text-sm text-gray-500 py-2 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Pulling recent order from Shopify...
            </div>
          ) : sampleOrder ? (
            <div className="text-sm text-gray-200 space-y-1">
              <div>
                <span className="text-gray-500">Customer:</span>{" "}
                {sampleOrder.customer_name}
              </div>
              <div>
                <span className="text-gray-500">Order:</span>{" "}
                {sampleOrder.order_name}
              </div>
              <div>
                <span className="text-gray-500">Items:</span>{" "}
                {sampleOrder.order_items}
              </div>
              <div>
                <span className="text-gray-500">Total:</span> ₱
                {sampleOrder.total}
              </div>
              <div>
                <span className="text-gray-500">Address:</span>{" "}
                {sampleOrder.address}
              </div>
              <div>
                <span className="text-gray-500">Payment:</span>{" "}
                {sampleOrder.payment_method}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No sample available</p>
          )}

          {sampleNote && (
            <p className="text-xs text-yellow-400/80 mt-2">{sampleNote}</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-300 mb-1">
              Your phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={initiating || (!!attempt && !isTerminal)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              placeholder="09171234567"
            />
            <p className="text-xs text-gray-500 mt-1">
              {phone && !normalizedPhone ? (
                <span className="text-red-400">
                  Hindi mukhang PH mobile number ito.
                </span>
              ) : normalizedPhone ? (
                <>Tatawagan: {normalizedPhone}</>
              ) : (
                <>09171234567, 9171234567 o +639171234567 — lahat okay.</>
              )}
            </p>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleCall}
              disabled={
                !ready ||
                initiating ||
                (!!attempt && !isTerminal) ||
                !normalizedPhone
              }
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {initiating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PhoneCall size={16} />
              )}
              {initiating
                ? "Initiating..."
                : !!attempt && !isTerminal
                ? "Call in progress"
                : "Call me now"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Live status / Result */}
      {attempt && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">
              Call Status
              {!isTerminal && (
                <Loader2
                  size={14}
                  className="inline-block ml-2 animate-spin text-gray-500"
                />
              )}
            </h3>
            <div className="flex items-center gap-3">
              {isTerminal && (
                <button
                  onClick={refreshAttempt}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  title="Sync latest from Vapi"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              )}
              <span
                className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${
                  STATUS_COLOR[attempt.status] ?? "bg-gray-700 text-gray-200"
                }`}
              >
                {STATUS_LABEL[attempt.status] ?? attempt.status}
              </span>
            </div>
          </div>

          {!isTerminal && (
            <p className="text-sm text-gray-400">
              Hintayin mo lang ang call sa phone mo. Polling for updates every
              2.5s...
            </p>
          )}

          {isTerminal && (
            <div className="space-y-4">
              {/* Surface failures prominently with troubleshooting hints */}
              {(attempt.status === "failed" ||
                attempt.status === "no_answer" ||
                attempt.status === "voicemail" ||
                attempt.status === "busy") &&
                !attempt.outcome && (
                  <FailureBanner
                    status={attempt.status}
                    reason={attempt.handoff_reason}
                  />
                )}

              {attempt.outcome && (
                <OutcomeBanner outcome={attempt.outcome} />
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Duration" value={`${attempt.duration_seconds ?? 0}s`} />
                <Stat
                  label="Cost"
                  value={`$${(attempt.cost_usd ?? 0).toFixed(3)}`}
                />
                <Stat
                  label="Sentiment"
                  value={attempt.customer_sentiment ?? "—"}
                />
                <Stat
                  label="VA Followup"
                  value={attempt.needs_va_followup ? "Yes" : "No"}
                />
              </div>

              {attempt.ai_summary && (
                <Section title="Summary">
                  <p className="text-sm text-gray-300">{attempt.ai_summary}</p>
                </Section>
              )}

              <Section title="Transcript">
                {attempt.transcript && attempt.transcript.length > 0 ? (
                  <div className="bg-gray-900/40 border border-gray-700/40 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                    {attempt.transcript.map((turn, i) => (
                      <div key={i} className="text-sm">
                        <span
                          className={`text-xs uppercase tracking-wide mr-2 ${
                            turn.role === "assistant"
                              ? "text-emerald-400"
                              : "text-blue-400"
                          }`}
                        >
                          {turn.role === "assistant" ? "Maria" : "You"}:
                        </span>
                        <span className="text-gray-200">{turn.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-gray-900/40 border border-gray-700/40 rounded-lg p-3 text-sm text-gray-500 italic">
                    No transcript captured for this call. May still be syncing
                    — click Refresh ↑ above. If the call failed before any
                    speech, transcript will stay empty (listen to recording
                    below to verify).
                  </div>
                )}
              </Section>

              <Section title="Recording">
                {attempt.recording_url ? (
                  <audio
                    src={attempt.recording_url}
                    controls
                    className="w-full"
                  />
                ) : (
                  <div className="bg-gray-900/40 border border-gray-700/40 rounded-lg p-3 text-sm text-gray-500 italic">
                    No recording available. May still be syncing — click
                    Refresh ↑ above.
                  </div>
                )}
              </Section>

              {attempt.handoff_reason && (
                <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg p-3 text-sm text-orange-200">
                  <strong>Handoff reason:</strong> {attempt.handoff_reason}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/40 border border-gray-700/40 rounded-lg px-3 py-2">
      <div className="text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm text-white font-medium mt-0.5">{value}</div>
    </div>
  );
}

function explainFailure(
  status: string,
  reason: string | null
): { title: string; hint: string } {
  if (status === "no_answer") {
    return {
      title: "Customer did not answer",
      hint: "Phone rang but no one picked up within 20 seconds. Will retry per Settings.",
    };
  }
  if (status === "voicemail") {
    return {
      title: "Hit voicemail",
      hint: "Detected an answering machine. Vapi hung up immediately to save cost.",
    };
  }
  if (status === "busy") {
    return {
      title: "Line busy",
      hint: "Customer's line was busy. Will retry later per Settings.",
    };
  }
  if (!reason) {
    return {
      title: "Call failed",
      hint: "No additional details. Refresh in 10s — the sync may catch up with Vapi.",
    };
  }
  // Map common Vapi error reasons to actionable hints
  const r = reason.toLowerCase();
  if (r.includes("did-not-receive-customer-audio")) {
    return {
      title: "Audio path broken (Vapi could not hear you)",
      hint: "Common with international Telnyx routes. Switch VAPI_PHONE_NUMBER_ID back to the Twilio number, or contact Vapi support if using Telnyx for PH outbound.",
    };
  }
  if (r.includes("error-get-transport")) {
    return {
      title: "Could not establish carrier connection",
      hint: "The phone number isn't properly linked to a carrier. Check Telnyx connection assignment + outbound voice profile.",
    };
  }
  if (r.includes("eleven-labs-voice-not-found")) {
    return {
      title: "Voice not accessible",
      hint: "The configured ElevenLabs voice ID isn't in your account. Pick a different voice in Settings tab or connect ElevenLabs in Vapi Integrations.",
    };
  }
  if (r.includes("max-duration")) {
    return {
      title: "Call hit max duration",
      hint: "Cut off at the per-call cap (Settings → Cost Guardrails). Increase the cap if needed.",
    };
  }
  if (r.includes("twilio-failed") || r.includes("telnyx-failed")) {
    return {
      title: "Carrier rejected the call",
      hint: "Trial accounts can only call verified numbers. Add credit to your Twilio/Telnyx account or verify this destination number.",
    };
  }
  if (r.includes("invalid-phone-number") || r.includes("invalid")) {
    return {
      title: "Invalid phone number",
      hint: "Make sure the number is in E.164 format (+639XXXXXXXXX) and is reachable.",
    };
  }
  return {
    title: "Call failed",
    hint: reason,
  };
}

function FailureBanner({
  status,
  reason,
}: {
  status: string;
  reason: string | null;
}) {
  const { title, hint } = explainFailure(status, reason);
  return (
    <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-2">
        <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-200">{title}</p>
          <p className="text-xs text-red-300/80 mt-1">{hint}</p>
          {reason && (
            <details className="mt-2">
              <summary className="text-xs text-red-300/60 cursor-pointer hover:text-red-300">
                Raw error
              </summary>
              <code className="block mt-1 text-[10px] text-red-300/70 bg-red-950/50 p-2 rounded font-mono break-all">
                {reason}
              </code>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function OutcomeBanner({ outcome }: { outcome: string }) {
  const config: Record<
    string,
    { icon: React.ReactNode; color: string; label: string }
  > = {
    confirmed: {
      icon: <CheckCircle2 size={16} />,
      color: "bg-emerald-900/30 border-emerald-700/50 text-emerald-200",
      label: "Order Confirmed",
    },
    declined: {
      icon: <XCircle size={16} />,
      color: "bg-red-900/30 border-red-700/50 text-red-200",
      label: "Customer Declined",
    },
    needs_callback: {
      icon: <Phone size={16} />,
      color: "bg-yellow-900/30 border-yellow-700/50 text-yellow-200",
      label: "Needs Callback",
    },
    escalated_to_human: {
      icon: <AlertTriangle size={16} />,
      color: "bg-orange-900/30 border-orange-700/50 text-orange-200",
      label: "Escalated to Human",
    },
    unreachable: {
      icon: <XCircle size={16} />,
      color: "bg-gray-700/40 border-gray-600/50 text-gray-300",
      label: "Unreachable",
    },
    invalid_number: {
      icon: <XCircle size={16} />,
      color: "bg-red-900/30 border-red-700/50 text-red-200",
      label: "Invalid Number",
    },
  };
  const c = config[outcome] ?? {
    icon: null,
    color: "bg-gray-700/40 border-gray-600/50 text-gray-300",
    label: outcome,
  };
  return (
    <div
      className={`${c.color} border rounded-lg p-3 flex items-center gap-2 text-sm font-medium`}
    >
      {c.icon}
      {c.label}
    </div>
  );
}
