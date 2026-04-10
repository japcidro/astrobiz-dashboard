"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, RefreshCw, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";
import type { JtUploadResult } from "@/lib/profit/types";

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
}

export function JtUploader() {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [result, setResult] = useState<JtUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      setPreview({
        rowCount: mappedRows.length,
        detectedStores: Array.from(storeSet).sort(),
        rows: mappedRows,
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

  const handleUpload = async () => {
    if (!preview) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/profit/jt-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: preview.rows }),
      });

      // Handle non-JSON responses (Vercel timeout returns HTML)
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status}). The upload may have timed out — try uploading fewer rows.`);
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to upload");
      setResult({
        inserted: json.inserted || 0,
        updated: json.updated || 0,
        total: json.total || 0,
        errors: json.errors || [],
      });
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload");
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
          Upload complete: {result.inserted} inserted, {result.updated} updated ({result.total} total)
          {result.errors && result.errors.length > 0 && (
            <span className="text-yellow-300 ml-2">
              ({result.errors.length} errors)
            </span>
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
              {uploading ? "Uploading..." : `Upload ${preview.rowCount} rows`}
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
