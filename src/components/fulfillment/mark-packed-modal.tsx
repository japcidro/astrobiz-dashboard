"use client";

import { useState } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import {
  MANUAL_CLEAR_REASONS,
  type ManualClearReasonCode,
  type UnfulfilledOrder,
} from "@/lib/fulfillment/types";

interface Props {
  orders: UnfulfilledOrder[];
  employeeName: string;
  onClose: () => void;
  onSuccess: (cleared: number, skipped: number) => void;
}

export function MarkPackedModal({
  orders,
  employeeName,
  onClose,
  onSuccess,
}: Props) {
  const [reasonCode, setReasonCode] =
    useState<ManualClearReasonCode>("catching_up_backlog");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = reasonCode === "other";
  const noteValid = !needsNote || note.trim().length >= 5;
  const canSubmit = orders.length > 0 && noteValid && !submitting;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/fulfillment/manual-clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason_code: reasonCode,
          note: note.trim(),
          orders: orders.map((o) => ({
            store_id: o.store_id,
            order_id: o.id,
            order_number: o.name,
            items_expected: o.item_count,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to clear orders");
      onSuccess(json.cleared ?? 0, json.skipped ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-white">
              Mark as Already Packed
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Removes selected orders from the Pick &amp; Pack list without a
              scan. All actions are logged.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Count */}
          <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3">
            <AlertTriangle
              size={16}
              className="text-yellow-400 mt-0.5 flex-shrink-0"
            />
            <div className="text-xs text-yellow-200">
              You are about to clear{" "}
              <span className="font-bold">{orders.length} order(s)</span> from
              the queue. This is reversible from the Audit page but should not
              be done lightly.
            </div>
          </div>

          {/* Preview list */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Orders to clear:</p>
            <div className="max-h-32 overflow-y-auto bg-gray-800/50 border border-gray-700/50 rounded-lg p-2 text-xs font-mono text-gray-300 space-y-0.5">
              {orders.slice(0, 30).map((o) => (
                <div key={o.id}>
                  {o.name} — {o.store_name} — {o.customer_name}
                </div>
              ))}
              {orders.length > 30 && (
                <div className="text-gray-500 italic">
                  …and {orders.length - 30} more
                </div>
              )}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Reason</label>
            <select
              value={reasonCode}
              onChange={(e) =>
                setReasonCode(e.target.value as ManualClearReasonCode)
              }
              disabled={submitting}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              {MANUAL_CLEAR_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Note{" "}
              {needsNote ? (
                <span className="text-red-400">(required, min 5 chars)</span>
              ) : (
                <span className="text-gray-500">(optional)</span>
              )}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              placeholder={
                needsNote
                  ? "Describe the reason for this clear…"
                  : "Optional context…"
              }
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Attribution */}
          <div className="text-xs text-gray-500">
            Clearing as:{" "}
            <span className="text-gray-300 font-medium">{employeeName}</span>
          </div>

          {/* Error */}
          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? "Clearing…" : `Confirm Clear (${orders.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
