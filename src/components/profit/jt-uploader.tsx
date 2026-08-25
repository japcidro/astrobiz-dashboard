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

/** "Aug 24, 10:05 PM" in PHT. */
function formatPhDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2 hours ago" / "3 days ago" — how stale the last upload is. */
function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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

      {/* Last upload — where to continue from */}
      {!historyLoading && (
        <div className="bg-gray-900/40 border border-gray-700/50 rounded-lg p-4">
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">
              Wala pang naitalang upload. Yung susunod mong i-upload ang unang mata-track dito.
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <History size={15} className="text-gray-400" />
                  <span className="text-sm font-medium text-white">Last upload</span>
                  <span className="text-xs text-gray-500">
                    {formatAgo(history[0].uploaded_at)}
                  </span>
                </div>
                {history.length > 1 && (
                  <button
                    onClick={() => setShowAllHistory((v) => !v)}
                    className="text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {showAllHistory ? "Hide" : `View last ${history.length}`}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Kailan</p>
                  <p className="text-white font-medium">
                    {formatPhDateTime(history[0].uploaded_at)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {history[0].row_count.toLocaleString()} parcels
                    {history[0].uploaded_by_name ? ` · ${history[0].uploaded_by_name}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Sakop na submission dates</p>
                  <p className="text-white font-medium">
                    {formatPhDate(history[0].submission_date_min)}
                    {" – "}
                    {formatPhDate(history[0].submission_date_max)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {history[0].file_name ||
                      (history[0].backfilled ? "filename not recorded" : "—")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Ituloy mo mula</p>
                  <p className="text-emerald-300 font-medium flex items-center gap-1.5">
                    <ArrowRight size={13} />
                    {formatPhDate(latestSubmission)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    pinakabagong parcel sa database
                  </p>
                </div>
              </div>

              {showAllHistory && history.length > 1 && (
                <div className="mt-4 pt-3 border-t border-gray-700/50 space-y-1.5">
                  {history.slice(1).map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between gap-3 text-xs text-gray-400"
                    >
                      <span className="text-gray-300 whitespace-nowrap">
                        {formatPhDateTime(b.uploaded_at)}
                      </span>
                      <span className="whitespace-nowrap">
                        {formatPhDate(b.submission_date_min)} – {formatPhDate(b.submission_date_max)}
                      </span>
                      <span className="text-gray-500 whitespace-nowrap">
                        {b.row_count.toLocaleString()} parcels
                      </span>
                    </div>
                  ))}
                </div>
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
              <span className="text-gray-400">Submission dates sa file:</span>{" "}
              <span className="text-white font-medium">
                {preview.submissionFrom || preview.submissionTo
                  ? `${formatPhDate(preview.submissionFrom)} – ${formatPhDate(preview.submissionTo)}`
                  : "Walang mabasang Submission Time"}
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
