"use client";

import { useState } from "react";
import { Loader2, X, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";

interface Props {
  adId: string;
  adName: string | null;
  storeNames: string[];
  defaultStore: string | null;
  defaultLabel?: string;
  onClose: () => void;
  onSuccess: (result: {
    approved_script_id: string;
    label: string;
    metrics: {
      roas: number;
      cpp: number;
      purchases: number;
      max_consecutive: number;
    } | null;
  }) => void;
}

export function AddToWinnersModal({
  adId,
  adName,
  storeNames,
  defaultStore,
  defaultLabel,
  onClose,
  onSuccess,
}: Props) {
  const [storeName, setStoreName] = useState<string>(
    defaultStore ?? (storeNames[0] ?? "")
  );
  const [label, setLabel] = useState<string>(defaultLabel ?? "External winner");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRedeconstruct, setNeedsRedeconstruct] = useState(false);

  const canSubmit = !submitting && storeName.trim() !== "" && label.trim() !== "";

  async function submit() {
    setSubmitting(true);
    setError(null);
    setNeedsRedeconstruct(false);
    try {
      const res = await fetch(
        "/api/ai/approved-scripts/promote-external-winner",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_id: adId,
            store_name: storeName.trim(),
            label: label.trim(),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        if (json.needs_redeconstruct) setNeedsRedeconstruct(true);
        throw new Error(json.error || "Failed to add to winners");
      }
      onSuccess({
        approved_script_id: json.approved_script_id,
        label: json.label,
        metrics: json.metrics,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to winners");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-400" />
              <h2 className="text-base font-bold text-white">
                Add to Winners Pool
              </h2>
            </div>
            <p className="text-xs text-gray-400 mt-1 truncate">
              {adName ?? adId}
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

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-400 leading-relaxed">
            This ad&apos;s deconstructed DNA will feed every future angle and
            format-expansion run for the chosen store. Performance metrics are
            pulled from Meta automatically.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">Store</label>
            <select
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              disabled={submitting || storeNames.length === 0}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
            >
              {storeNames.length === 0 ? (
                <option value="">No stores available</option>
              ) : (
                storeNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={submitting}
              placeholder="External winner"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
            <p className="text-[10px] text-gray-500">
              Shows up sa winners block ng generator. Pwedeng descriptive (e.g.
              &ldquo;OG Ozempic patch — affordability angle&rdquo;).
            </p>
          </div>

          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                {error}
                {needsRedeconstruct && (
                  <p className="mt-1 text-red-200/80">
                    Tip: i-close mo muna to, click <em>Re-run</em> sa
                    deconstruction modal, then try again.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-gray-300 hover:text-white px-3 py-2 cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {submitting ? "Adding…" : "Add to Winners"}
          </button>
        </div>
      </div>
    </div>
  );
}
