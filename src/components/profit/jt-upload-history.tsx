"use client";

import { useState, useEffect, useCallback } from "react";
import { History, ArrowRight, AlertCircle } from "lucide-react";
import type { JtUploadBatch } from "@/lib/profit/types";
import {
  formatPhDate,
  formatPhDateTime,
  formatDateRange,
  formatAgo,
} from "@/lib/profit/format-dates";

/** Rows shown before the "Show all" toggle kicks in. */
const HISTORY_PREVIEW_ROWS = 8;

/**
 * How far behind the delivery data can fall before the panel warns about it.
 * J&T uploads were a near-daily habit, so anything past a few days is a lapse.
 */
const STALE_AFTER_DAYS = 3;

interface JtUploadHistoryProps {
  /** Bump to re-fetch — the uploader raises it after a file finishes. */
  refreshKey?: number;
}

/**
 * When the last J&T file was uploaded, what submission dates it covered, and
 * where to pick up. Lives on the dashboard itself rather than inside the
 * collapsible uploader: the question "san ako titigil?" comes up before you
 * decide to upload, not after.
 */
export function JtUploadHistory({ refreshKey = 0 }: JtUploadHistoryProps) {
  const [history, setHistory] = useState<JtUploadBatch[]>([]);
  const [latestSubmission, setLatestSubmission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/profit/jt-upload", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setHistory(json.batches || []);
      setLatestSubmission(json.latest_submission_date ?? null);
    } catch {
      // Non-fatal — the dashboard and uploader work without this panel.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshKey]);

  if (loading) return null;

  // How stale is the delivery data? Measured from the newest parcel in the
  // database, not the last upload — uploading a file of old rows doesn't
  // catch you up.
  const daysBehind =
    latestSubmission === null
      ? null
      : Math.floor((Date.now() - new Date(latestSubmission).getTime()) / 86400000);
  const isStale = daysBehind !== null && daysBehind > STALE_AFTER_DAYS;

  const visible = showAll ? history : history.slice(0, HISTORY_PREVIEW_ROWS);

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <History size={16} className="text-gray-400" />
        <h3 className="text-base font-semibold text-white">Upload History</h3>
      </div>

      {history.length === 0 ? (
        <p className="text-sm text-gray-500">
          No uploads recorded yet. The next file you upload will be tracked here.
        </p>
      ) : (
        <>
          {/* Where to continue from — the whole point of this panel */}
          <div
            className={`flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border p-3 mb-4 ${
              isStale
                ? "bg-amber-900/20 border-amber-700/50"
                : "bg-emerald-900/20 border-emerald-700/50"
            }`}
          >
            <div className="flex items-center gap-2">
              {isStale && <AlertCircle size={16} className="text-amber-400 shrink-0" />}
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Last uploaded
                </p>
                <p
                  className={`text-sm font-semibold ${
                    isStale ? "text-amber-200" : "text-emerald-200"
                  }`}
                >
                  {formatPhDateTime(history[0].uploaded_at)}
                  <span className="font-normal text-gray-400 ml-2">
                    {formatAgo(history[0].uploaded_at)}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ArrowRight size={14} className="text-gray-500 shrink-0" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Continue from
                </p>
                <p
                  className={`text-sm font-semibold ${
                    isStale ? "text-amber-200" : "text-emerald-200"
                  }`}
                >
                  {formatPhDate(latestSubmission)}
                  {daysBehind !== null && daysBehind > 0 && (
                    <span className="font-normal text-gray-400 ml-2">
                      {daysBehind} day{daysBehind === 1 ? "" : "s"} of delivery data
                      missing
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-700/50">
                  <th className="font-medium px-2 py-2 whitespace-nowrap">
                    Uploaded (PHT)
                  </th>
                  <th className="font-medium px-2 py-2 text-right whitespace-nowrap">
                    Parcels
                  </th>
                  <th className="font-medium px-2 py-2 whitespace-nowrap">
                    Submission dates covered
                  </th>
                  <th className="font-medium px-2 py-2 whitespace-nowrap">Stores</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b, i) => (
                  <tr
                    key={b.id}
                    className={`border-b border-gray-700/30 ${
                      i === 0 ? "bg-gray-700/20" : ""
                    }`}
                  >
                    <td
                      className={`px-2 py-2 whitespace-nowrap ${
                        i === 0 ? "text-white font-medium" : "text-gray-300"
                      }`}
                    >
                      {formatPhDateTime(b.uploaded_at)}
                      {b.file_name && (
                        <span className="block text-[11px] text-gray-500 font-normal truncate max-w-[220px]">
                          {b.file_name}
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${
                        i === 0 ? "text-white font-medium" : "text-gray-300"
                      }`}
                    >
                      {b.row_count.toLocaleString()}
                    </td>
                    <td
                      className={`px-2 py-2 whitespace-nowrap ${
                        i === 0 ? "text-white font-medium" : "text-gray-300"
                      }`}
                    >
                      {formatDateRange(b.submission_date_min, b.submission_date_max)}
                    </td>
                    <td className="px-2 py-2 text-gray-400 text-xs">
                      {b.stores.length > 0 ? b.stores.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {history.length > HISTORY_PREVIEW_ROWS && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              {showAll ? "Show fewer" : `Show all ${history.length} uploads`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
