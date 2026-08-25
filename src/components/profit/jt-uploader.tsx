"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, RefreshCw, CheckCircle, AlertCircle, FileSpreadsheet, History, ArrowRight } from "lucide-react";
import type { JtUploadResult, JtUploadBatch } from "@/lib/profit/types";

const COLUMN_MAP: Record<string, string> = {
  "Waybill Number": "waybill",
  "Order Status": "order_status",
  "Cod": "cod",
  "Province": "province",
  "Submission Time": "submission_time",
  "Item Name": "item_name",
  "Number Of Items": "num_items",
  "Sender Name": "sender_name",
  "Total Shipping Cost": "total_shipping_cost",
  "Receiver": "receiver",
  "City": "city",
  "RTS Reason": "rts_reason",
  "Item Value": "item_value",
  "Payment Method": "payment_method",
  "SigningTime": "signing_time",
};

/** Rows shown before the "Show all" toggle kicks in. */
const HISTORY_PREVIEW_ROWS = 8;

/**
 * How far behind the delivery data can fall before the panel warns about it.
 * J&T uploads were a near-daily habit, so anything past a few days is a lapse.
 */
const STALE_AFTER_DAYS = 3;

interface ParsedPreview {
  rowCount: number;
  detectedStores: string[];
  rows: Record<string, unknown>[];
  fileName: string;
  submissionFrom: string | null;
  submissionTo: string | null;
}

/**
 * J&T "Submission Time" arrives as either an Excel serial number or a
 * "YYYY-MM-DD HH:mm:ss" string. Mirror the server's parseJtDate so the preview
 * shows the same range the history will record.
 */
function parseSubmissionTime(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(new Date(1899, 11, 30).getTime() + value * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  if (!str || str === "NaN" || str === "--") return null;
  const d = new Date(
    str.replace(" ", "T") + (str.includes("+") || str.includes("Z") ? "" : "+08:00")
  );
  if (!isNaN(d.getTime())) return d;
  const d2 = new Date(str);
  return isNaN(d2.getTime()) ? null : d2;
}

/** "Aug 23, 2026" in PHT — J&T dates are always Philippine time. */
function formatPhDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Aug 24, 2026, 10:05 PM" in PHT. The year matters once a gap opens up. */
function formatPhDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function phPart(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    ...opts,
  });
}

/**
 * Collapse a submission range to the shortest unambiguous form:
 *   same day    -> "May 2, 2026"
 *   same month  -> "May 8 – 10, 2026"
 *   same year   -> "Apr 30 – May 1, 2026"
 *   otherwise   -> "Dec 30, 2025 – Jan 2, 2026"
 */
function formatDateRange(
  min: string | null | undefined,
  max: string | null | undefined
): string {
  if (!min && !max) return "—";
  if (!min || !max) return formatPhDate(min || max);

  const opts = { month: "short", day: "numeric" } as const;
  const startFull = formatPhDate(min);
  const endFull = formatPhDate(max);
  if (startFull === endFull) return startFull;

  const sameYear = phPart(min, { year: "numeric" }) === phPart(max, { year: "numeric" });
  if (!sameYear) return `${startFull} – ${endFull}`;

  const sameMonth = phPart(min, { month: "short" }) === phPart(max, { month: "short" });
  if (sameMonth) {
    return `${phPart(min, opts)} – ${phPart(max, { day: "numeric" })}, ${phPart(max, { year: "numeric" })}`;
  }
  return `${phPart(min, opts)} – ${endFull}`;
}

/** "2 hours ago" / "3 days ago" / "3 months ago" — how stale the last upload is. */
function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30.44);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function JtUploader() {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [result, setResult] = useState<JtUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JtUploadBatch[]>([]);
  const [latestSubmission, setLatestSubmission] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/profit/jt-upload", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setHistory(json.batches || []);
      setLatestSubmission(json.latest_submission_date ?? null);
    } catch {
      // Non-fatal — the uploader still works without the history panel.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const processFile = useCallback(async (file: File) => {
    setParsing(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      if (rawRows.length === 0) {
        throw new Error("No data found in the spreadsheet");
      }

      // Map columns
      const mappedRows = rawRows.map((raw) => {
        const mapped: Record<string, unknown> = {};
        for (const [excelCol, apiCol] of Object.entries(COLUMN_MAP)) {
          if (raw[excelCol] !== undefined) {
            mapped[apiCol] = raw[excelCol];
          }
        }
        return mapped;
      });

      // Detect stores from sender_name
      const storeSet = new Set<string>();
      for (const row of mappedRows) {
        const sender = row.sender_name;
        if (sender && typeof sender === "string" && sender.trim()) {
          storeSet.add(sender.trim());
        }
      }

      // Submission range of THIS file — shown before uploading so you can
      // confirm it picks up where the last one left off.
      let minSubmit: number | null = null;
      let maxSubmit: number | null = null;
      for (const row of mappedRows) {
        const d = parseSubmissionTime(row.submission_time);
        if (!d) continue;
        const t = d.getTime();
        if (minSubmit === null || t < minSubmit) minSubmit = t;
        if (maxSubmit === null || t > maxSubmit) maxSubmit = t;
      }

      setPreview({
        rowCount: mappedRows.length,
        detectedStores: Array.from(storeSet).sort(),
        rows: mappedRows,
        fileName: file.name,
        submissionFrom: minSubmit === null ? null : new Date(minSubmit).toISOString(),
        submissionTo: maxSubmit === null ? null : new Date(maxSubmit).toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const [uploadProgress, setUploadProgress] = useState("");

  const handleUpload = async () => {
    if (!preview) return;
    setUploading(true);
    setError(null);
    try {
      // Upload in batches of 100 from the client to avoid Vercel timeout
      const BATCH_SIZE = 100;
      const allRows = preview.rows;
      // One id for the whole file — the server accumulates the chunks under it.
      const batchId = crypto.randomUUID();
      let totalInserted = 0;
      let totalProtected = 0;
      const allErrors: string[] = [];

      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);
        setUploadProgress(`Uploading batch ${batchNum}/${totalBatches} (${Math.min(i + BATCH_SIZE, allRows.length)}/${allRows.length} rows)...`);

        const res = await fetch("/api/profit/jt-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: batch,
            batch_id: batchId,
            file_name: preview.fileName,
          }),
        });

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error(`Batch ${batchNum} failed (${res.status}). Try again.`);
        }

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Batch ${batchNum} failed`);

        totalInserted += json.inserted || 0;
        totalProtected += json.protected_returns || 0;
        if (json.errors?.length) allErrors.push(...json.errors);
      }

      setResult({
        inserted: totalInserted,
        updated: 0,
        total: allRows.length,
        protected_returns: totalProtected,
        errors: allErrors,
      });
      setPreview(null);
      setUploadProgress("");
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload");
      setUploadProgress("");
    } finally {
      setUploading(false);
    }
  };

  // How stale is the delivery data? Measured from the newest parcel in the
  // database, not the last upload — an upload of old rows doesn't catch you up.
  const daysBehind =
    latestSubmission === null
      ? null
      : Math.floor((Date.now() - new Date(latestSubmission).getTime()) / 86400000);
  const isStale = daysBehind !== null && daysBehind > STALE_AFTER_DAYS;

  const visibleHistory = showAllHistory
    ? history
    : history.slice(0, HISTORY_PREVIEW_ROWS);

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-emerald-600/20 rounded-lg">
          <FileSpreadsheet size={20} className="text-emerald-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">J&T Upload</h3>
          <p className="text-sm text-gray-400">
            Upload J&T delivery report (.xlsx / .xls)
          </p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {result && (
        <div className="p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
          <CheckCircle size={16} />
          Upload complete: {result.inserted} inserted ({result.total} total)
          {result.protected_returns > 0 && (
            <span className="text-amber-300 ml-1">
              &middot; {result.protected_returns} confirmed returns preserved
            </span>
          )}
          {result.errors && result.errors.length > 0 && (
            <span className="text-yellow-300 ml-2">
              ({result.errors.length} errors)
            </span>
          )}
        </div>
      )}

      {/* Upload history — when you last uploaded and what it covered */}
      {!historyLoading && (
        <div className="bg-gray-900/40 border border-gray-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <History size={15} className="text-gray-400" />
            <span className="text-sm font-medium text-white">Upload History</span>
          </div>

          {history.length === 0 ? (
            <p className="text-sm text-gray-500">
              No uploads recorded yet. The next file you upload will be tracked here.
            </p>
          ) : (
            <>
              {/* Where to continue from — the whole point of this panel */}
              <div
                className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-3 mb-4 ${
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
                          {daysBehind} day{daysBehind === 1 ? "" : "s"} of delivery data missing
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Full history table */}
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-700/50">
                      <th className="font-medium px-2 py-2 whitespace-nowrap">Uploaded (PHT)</th>
                      <th className="font-medium px-2 py-2 text-right whitespace-nowrap">Parcels</th>
                      <th className="font-medium px-2 py-2 whitespace-nowrap">
                        Submission dates covered
                      </th>
                      <th className="font-medium px-2 py-2 whitespace-nowrap">Stores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((b, i) => (
                      <tr
                        key={b.id}
                        className={`border-b border-gray-700/30 ${
                          i === 0 ? "bg-gray-800/40" : ""
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
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="mt-3 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  {showAllHistory
                    ? "Show fewer"
                    : `Show all ${history.length} uploads`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Drop zone */}
      {!preview && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-emerald-500 bg-emerald-900/10"
              : "border-gray-600 hover:border-gray-500 bg-gray-900/20"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          {parsing ? (
            <RefreshCw size={32} className="mx-auto mb-3 text-emerald-400 animate-spin" />
          ) : (
            <Upload size={32} className="mx-auto mb-3 text-gray-500" />
          )}
          <p className="text-gray-400 text-sm">
            {parsing
              ? "Parsing file..."
              : "Drag & drop J&T .xlsx file here, or click to browse"}
          </p>
          <p className="text-gray-600 text-xs mt-1">
            Accepts .xlsx and .xls files
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="bg-gray-700/30 border border-gray-600/50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-white font-medium">File Preview</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-400">Rows detected:</span>{" "}
              <span className="text-white font-medium">{preview.rowCount}</span>
            </div>
            <div>
              <span className="text-gray-400">Stores (Sender Name):</span>{" "}
              <span className="text-white font-medium">
                {preview.detectedStores.length > 0
                  ? preview.detectedStores.join(", ")
                  : "None detected"}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">Submission dates in this file:</span>{" "}
              <span className="text-white font-medium">
                {preview.submissionFrom || preview.submissionTo
                  ? formatDateRange(preview.submissionFrom, preview.submissionTo)
                  : "No readable Submission Time"}
              </span>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploading ? (uploadProgress || "Uploading...") : `Upload ${preview.rowCount} rows`}
            </button>
            <button
              onClick={() => {
                setPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
