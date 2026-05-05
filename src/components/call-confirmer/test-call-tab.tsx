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
  ShoppingBag,
} from "lucide-react";
import type {
  CallConfirmerConfig,
  CallAttempt,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import type { OrderContext } from "@/lib/call-confirmer/assistant";
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
  const [sampleSource, setSampleSource] = useState<"shopify" | "synthetic" | null>(
    null
  );
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
      setSampleSource(data.source);
      setSampleNote(data.reason ?? null);
    } catch (e: unknown) {
      setSampleOrder(null);
      setSampleSource(null);
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
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/admin/call-confirmer/attempts/${id}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Poll failed");
        setAttempt(data.attempt);
        if (TERMINAL_STATUSES.has(data.attempt.status)) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Don't kill polling on transient errors
      }
    }, 2500);
  };

  const handleCall = async () => {
    setError(null);
    if (!/^\+\d{10,15}$/.test(phone)) {
      setError("Phone must be in E.164 format (e.g. +639171234567)");
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
          customer_phone: phone,
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
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                Sample order Maria will read:
              </p>
              {sampleSource === "shopify" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 flex items-center gap-1">
                  <ShoppingBag size={10} />
                  Live Shopify
                </span>
              )}
              {sampleSource === "synthetic" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                  Synthetic (no Shopify orders)
                </span>
              )}
            </div>
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
              Your phone (E.164)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={initiating || (!!attempt && !isTerminal)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              placeholder="+639171234567"
            />
            <p className="text-xs text-gray-500 mt-1">
              Make sure this number is verified in Twilio Console (or you
              upgraded out of trial).
            </p>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleCall}
              disabled={
                !ready ||
                initiating ||
                (!!attempt && !isTerminal) ||
                !phone
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
            <span
              className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${
                STATUS_COLOR[attempt.status] ?? "bg-gray-700 text-gray-200"
              }`}
            >
              {STATUS_LABEL[attempt.status] ?? attempt.status}
            </span>
          </div>

          {!isTerminal && (
            <p className="text-sm text-gray-400">
              Hintayin mo lang ang call sa phone mo. Polling for updates every
              2.5s...
            </p>
          )}

          {isTerminal && (
            <div className="space-y-4">
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

              {attempt.transcript && attempt.transcript.length > 0 && (
                <Section title="Transcript">
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
                </Section>
              )}

              {attempt.recording_url && (
                <Section title="Recording">
                  <audio
                    src={attempt.recording_url}
                    controls
                    className="w-full"
                  />
                </Section>
              )}

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
