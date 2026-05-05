"use client";

import { useState, useEffect, useCallback } from "react";
import {
  History,
  Loader2,
  RefreshCw,
  X,
  CheckCircle2,
  XCircle,
  Phone,
  AlertTriangle,
  TestTube2,
} from "lucide-react";
import type {
  CallAttempt,
  ShopifyStoreLite,
} from "@/lib/call-confirmer/types";
import { StoreSelector, ALL_STORES_VALUE } from "./store-selector";

interface Props {
  stores: ShopifyStoreLite[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
}

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

const OUTCOME_BADGE: Record<
  string,
  { color: string; label: string; icon: React.ReactNode }
> = {
  confirmed: {
    color: "bg-emerald-600 text-white",
    label: "Confirmed",
    icon: <CheckCircle2 size={12} />,
  },
  declined: {
    color: "bg-red-600 text-white",
    label: "Declined",
    icon: <XCircle size={12} />,
  },
  needs_callback: {
    color: "bg-yellow-600 text-white",
    label: "Callback",
    icon: <Phone size={12} />,
  },
  escalated_to_human: {
    color: "bg-orange-600 text-white",
    label: "Escalated",
    icon: <AlertTriangle size={12} />,
  },
  unreachable: {
    color: "bg-gray-600 text-gray-200",
    label: "Unreachable",
    icon: <XCircle size={12} />,
  },
};

type ScopeFilter = "all" | "real" | "test";

export function HistoryTab({ stores, selectedStoreId, onStoreChange }: Props) {
  // History defaults to "All stores" so admin can debug across stores easily
  const [historyStoreId, setHistoryStoreId] = useState<string>(ALL_STORES_VALUE);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedAttempt, setSelectedAttempt] = useState<CallAttempt | null>(
    null
  );

  // Keep parent in sync when user picks a specific store (so other tabs follow)
  const handleStoreChange = (id: string) => {
    setHistoryStoreId(id);
    if (id !== ALL_STORES_VALUE) onStoreChange(id);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (historyStoreId && historyStoreId !== ALL_STORES_VALUE)
        params.set("store_id", historyStoreId);
      if (scope === "test") params.set("only_test", "true");
      if (scope === "real") params.set("include_test", "false");
      const res = await fetch(
        `/api/admin/call-confirmer/attempts?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setAttempts(data.attempts ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [historyStoreId, scope]);

  useEffect(() => {
    load();
  }, [historyStoreId, scope, load]);

  // suppress unused var warning while keeping the prop available for future use
  void selectedStoreId;

  const refreshSingle = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/call-confirmer/attempts/${id}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedAttempt(data.attempt);
        setAttempts((prev) =>
          prev.map((a) => (a.id === id ? data.attempt : a))
        );
      }
    } catch {
      /* swallow */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <StoreSelector
          stores={stores}
          value={historyStoreId}
          onChange={handleStoreChange}
          includeAllOption
        />
        <div className="flex items-center gap-2">
          <ScopeFilterButton
            value={scope}
            onChange={setScope}
            option="all"
            label="All"
          />
          <ScopeFilterButton
            value={scope}
            onChange={setScope}
            option="real"
            label="Real"
          />
          <ScopeFilterButton
            value={scope}
            onChange={setScope}
            option="test"
            label="Test"
          />
          <button
            onClick={load}
            disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Stats strip */}
      <StatsStrip attempts={attempts} />

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        {loading && attempts.length === 0 ? (
          <div className="p-12 text-center">
            <Loader2 size={20} className="mx-auto animate-spin text-gray-500" />
          </div>
        ) : attempts.length === 0 ? (
          <div className="p-12 text-center">
            <History size={28} className="mx-auto text-gray-600 mb-2" />
            <p className="text-sm text-gray-400">No call attempts yet for this store.</p>
            <p className="text-xs text-gray-500 mt-1">
              Try a Test Call first or wait for real customer calls.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/40 text-gray-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Outcome</th>
                  <th className="text-right px-4 py-3">Dur</th>
                  <th className="text-right px-4 py-3">Cost</th>
                  <th className="text-center px-4 py-3">Try</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {attempts.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedAttempt(a)}
                    className="hover:bg-gray-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">
                      {formatDate(a.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-white font-medium">
                        {a.customer_name ?? "—"}
                        {a.is_test_call && (
                          <TestTube2
                            size={12}
                            className="inline ml-1.5 text-gray-500"
                          />
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.customer_phone}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">
                      {a.shopify_order_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
                          STATUS_COLOR[a.status] ?? "bg-gray-700 text-gray-200"
                        }`}
                      >
                        {a.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.outcome ? (
                        <OutcomeBadge outcome={a.outcome} />
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {a.duration_seconds != null
                        ? `${a.duration_seconds}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {a.cost_usd != null
                        ? `$${Number(a.cost_usd).toFixed(3)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-400">
                      #{a.attempt_number}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer */}
      {selectedAttempt && (
        <AttemptDrawer
          attempt={selectedAttempt}
          onClose={() => setSelectedAttempt(null)}
          onRefresh={() => refreshSingle(selectedAttempt.id)}
        />
      )}
    </div>
  );
}

function ScopeFilterButton({
  value,
  onChange,
  option,
  label,
}: {
  value: ScopeFilter;
  onChange: (v: ScopeFilter) => void;
  option: ScopeFilter;
  label: string;
}) {
  const active = value === option;
  return (
    <button
      onClick={() => onChange(option)}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
        active
          ? "bg-emerald-600 text-white"
          : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const c = OUTCOME_BADGE[outcome];
  if (!c)
    return (
      <span className="text-xs text-gray-400">{outcome.replace(/_/g, " ")}</span>
    );
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${c.color}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function StatsStrip({ attempts }: { attempts: CallAttempt[] }) {
  const total = attempts.length;
  const confirmed = attempts.filter((a) => a.outcome === "confirmed").length;
  const failed = attempts.filter(
    (a) => a.status === "failed" || a.outcome === "unreachable"
  ).length;
  const totalCost = attempts.reduce(
    (sum, a) => sum + Number(a.cost_usd ?? 0),
    0
  );
  const totalDuration = attempts.reduce(
    (sum, a) => sum + (a.duration_seconds ?? 0),
    0
  );
  const confirmRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Total" value={String(total)} />
      <Stat label="Confirmed" value={String(confirmed)} />
      <Stat label="Confirm %" value={`${confirmRate}%`} />
      <Stat label="Total Time" value={`${Math.round(totalDuration / 60)}m`} />
      <Stat label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2">
      <div className="text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg text-white font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function AttemptDrawer({
  attempt,
  onClose,
  onRefresh,
}: {
  attempt: CallAttempt;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-gray-900 border-l border-gray-800 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-medium">
              {attempt.customer_name ?? "—"}
              {attempt.is_test_call && (
                <span className="ml-2 text-xs text-gray-500">(test)</span>
              )}
            </h3>
            <p className="text-xs text-gray-500">
              {attempt.customer_phone} · {attempt.shopify_order_name ?? "—"} ·
              attempt #{attempt.attempt_number}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="text-xs text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800"
              title="Sync from Vapi"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-3">
            <span
              className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${
                STATUS_COLOR[attempt.status] ?? "bg-gray-700 text-gray-200"
              }`}
            >
              {attempt.status.replace(/_/g, " ")}
            </span>
            {attempt.outcome && <OutcomeBadge outcome={attempt.outcome} />}
            {attempt.needs_va_followup && (
              <span className="text-xs px-2 py-1 rounded bg-orange-900/40 border border-orange-700/40 text-orange-200">
                VA followup needed
              </span>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              label="Duration"
              value={`${attempt.duration_seconds ?? 0}s`}
            />
            <Stat
              label="Cost"
              value={`$${Number(attempt.cost_usd ?? 0).toFixed(3)}`}
            />
            <Stat
              label="Sentiment"
              value={attempt.customer_sentiment ?? "—"}
            />
            <Stat
              label="Test"
              value={attempt.is_test_call ? "Yes" : "No"}
            />
          </div>

          {attempt.handoff_reason && (
            <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg p-3 text-sm">
              <strong className="text-orange-200">Handoff reason:</strong>
              <span className="text-orange-100 ml-1">
                {attempt.handoff_reason}
              </span>
            </div>
          )}

          {attempt.ai_summary && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                AI Summary
              </h4>
              <p className="text-sm text-gray-300 leading-relaxed">
                {attempt.ai_summary}
              </p>
            </div>
          )}

          {attempt.transcript && attempt.transcript.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                Transcript
              </h4>
              <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-3 space-y-2">
                {attempt.transcript.map((turn, i) => (
                  <div key={i} className="text-sm">
                    <span
                      className={`text-xs uppercase tracking-wide mr-2 ${
                        turn.role === "assistant"
                          ? "text-emerald-400"
                          : "text-blue-400"
                      }`}
                    >
                      {turn.role === "assistant" ? "Maria" : "Customer"}:
                    </span>
                    <span className="text-gray-200">{turn.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {attempt.recording_url && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                Recording
              </h4>
              <audio
                src={attempt.recording_url}
                controls
                className="w-full"
              />
            </div>
          )}

          {!attempt.transcript &&
            !attempt.ai_summary &&
            attempt.status === "completed" && (
              <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-4 text-sm text-gray-400 text-center">
                Transcript still syncing from Vapi. Click <RefreshCw
                  size={12}
                  className="inline"
                /> above to pull fresh data.
              </div>
            )}

          <div className="text-xs text-gray-600 pt-2 border-t border-gray-800">
            Created: {new Date(attempt.created_at).toLocaleString()}
            {attempt.ended_at && (
              <>
                {" · "}Ended: {new Date(attempt.ended_at).toLocaleString()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
