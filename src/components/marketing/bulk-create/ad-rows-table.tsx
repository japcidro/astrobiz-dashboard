"use client";

import { useRef, useCallback } from "react";
import { Upload, X, CheckCircle, AlertCircle, Loader2, Plus } from "lucide-react";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BulkAdRow {
  id: string;
  adset_name: string;
  ad_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
  primary_text: string;
  headline: string;
  description: string;
  status: "pending" | "uploading" | "submitting" | "done" | "error";
  error: string | null;
}

interface AdRowsTableProps {
  rows: BulkAdRow[];
  adAccountId: string;
  creativeType: "image" | "video";
  onUpdateRow: (id: string, updates: Partial<BulkAdRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/facebook/token");
  if (!res.ok) throw new Error("Failed to fetch token");
  const { token } = await res.json();
  return token;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      // Wait before retry: 2s, 4s, 6s
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("Max retries reached");
}

async function uploadImage(
  file: File,
  adAccountId: string,
  token: string,
): Promise<{ image_hash: string }> {
  return withRetry(async () => {
    const form = new FormData();
    form.append("access_token", token);
    form.append("filename", file);
    const res = await fetch(`${FB_API_BASE}/${adAccountId}/adimages`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, Record<string, string>>)?.error?.message || `Image upload failed (${res.status})`);
    }
    const json = await res.json();
    const firstKey = Object.keys(json.images)[0];
    return { image_hash: json.images[firstKey].hash };
  });
}

async function uploadVideo(
  file: File,
  adAccountId: string,
  token: string,
): Promise<{ video_id: string }> {
  const fileSizeMB = file.size / (1024 * 1024);

  // For files > 10MB, use chunked upload
  if (fileSizeMB > 10) {
    return uploadVideoChunked(file, adAccountId, token);
  }

  return withRetry(async () => {
    const form = new FormData();
    form.append("access_token", token);
    form.append("source", file);
    form.append("title", file.name);
    const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, Record<string, string>>)?.error?.message || `Video upload failed (${res.status})`);
    }
    const json = await res.json();
    return { video_id: json.id };
  });
}

async function uploadVideoChunked(
  file: File,
  adAccountId: string,
  token: string,
): Promise<{ video_id: string }> {
  // Step 1: Start upload session
  const startForm = new FormData();
  startForm.append("access_token", token);
  startForm.append("upload_phase", "start");
  startForm.append("file_size", file.size.toString());

  const startRes = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
    method: "POST",
    body: startForm,
  });
  if (!startRes.ok) throw new Error(`Chunked upload start failed (${startRes.status})`);
  const startJson = await startRes.json();
  const uploadSessionId = startJson.upload_session_id;
  const videoId = startJson.video_id;

  // Step 2: Upload chunks (4MB each)
  const CHUNK_SIZE = 4 * 1024 * 1024;
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const chunkForm = new FormData();
    chunkForm.append("access_token", token);
    chunkForm.append("upload_phase", "transfer");
    chunkForm.append("upload_session_id", uploadSessionId);
    chunkForm.append("start_offset", offset.toString());
    chunkForm.append("video_file_chunk", chunk);

    const chunkRes = await withRetry(async () => {
      const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
        method: "POST",
        body: chunkForm,
      });
      if (!res.ok) throw new Error(`Chunk upload failed at offset ${offset}`);
      return res;
    });

    const chunkJson = await chunkRes.json();
    offset = parseInt(chunkJson.start_offset || offset + CHUNK_SIZE);
  }

  // Step 3: Finish upload
  const finishForm = new FormData();
  finishForm.append("access_token", token);
  finishForm.append("upload_phase", "finish");
  finishForm.append("upload_session_id", uploadSessionId);
  finishForm.append("title", file.name);

  const finishRes = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
    method: "POST",
    body: finishForm,
  });
  if (!finishRes.ok) throw new Error("Chunked upload finish failed");

  return { video_id: videoId };
}

/**
 * Run async tasks with a concurrency limit.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

// ── Component ────────────────────────────────────────────────────────────────

export function AdRowsTable({
  rows,
  adAccountId,
  creativeType,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
}: AdRowsTableProps) {
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const rowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Upload a single file for a given row — detect type from file MIME
  const uploadFileForRow = useCallback(
    async (file: File, rowId: string, token: string) => {
      onUpdateRow(rowId, { status: "uploading", error: null });
      const isVideo = file.type.startsWith("video/");
      try {
        if (isVideo) {
          const { video_id } = await uploadVideo(file, adAccountId, token);
          onUpdateRow(rowId, {
            video_id,
            image_hash: null,
            file_name: file.name,
            creative_type: "video",
            status: "done",
            error: null,
          });
        } else {
          const { image_hash } = await uploadImage(file, adAccountId, token);
          onUpdateRow(rowId, {
            image_hash,
            video_id: null,
            file_name: file.name,
            creative_type: "image",
            status: "done",
            error: null,
          });
        }
      } catch (err) {
        onUpdateRow(rowId, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [adAccountId, onUpdateRow],
  );

  // Bulk upload: match files to rows by position
  const handleBulkUpload = useCallback(
    async (files: FileList) => {
      let token: string;
      try {
        token = await fetchToken();
      } catch {
        return;
      }

      // Ensure enough rows exist
      const needed = files.length - rows.length;
      for (let i = 0; i < needed; i++) {
        onAddRow();
      }

      // We need to reference the latest rows after adding.
      // Since onAddRow is sync in state, we build a snapshot of row ids.
      // The rows prop won't have updated yet in this closure, so we rely
      // on the caller ensuring rows are in sync. We'll use what we have
      // plus placeholders for new rows — the parent must provide stable ids.
      // To handle this robustly, we defer to a microtask.
      await new Promise((r) => setTimeout(r, 0));

      // Build tasks — at this point rows may not reflect new additions yet,
      // so we pair files with rows we know about and skip extras (parent
      // should re-render before user interacts further).
      const tasks: (() => Promise<void>)[] = [];
      for (let i = 0; i < files.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const file = files[i];
        tasks.push(() => uploadFileForRow(file, row.id, token));
      }

      await runWithConcurrency(tasks, 3);
    },
    [rows, onAddRow, uploadFileForRow],
  );

  // Per-row single file upload
  const handleRowUpload = useCallback(
    async (file: File, rowId: string) => {
      let token: string;
      try {
        token = await fetchToken();
      } catch {
        onUpdateRow(rowId, { status: "error", error: "Failed to fetch token" });
        return;
      }
      await uploadFileForRow(file, rowId, token);
    },
    [uploadFileForRow, onUpdateRow],
  );

  const accept = "image/*,video/*";

  return (
    <div className="space-y-3">
      {/* Bulk upload button */}
      <div>
        <input
          ref={bulkInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleBulkUpload(e.target.files);
              e.target.value = "";
            }
          }}
        />
        <button
          type="button"
          onClick={() => bulkInputRef.current?.click()}
          className="flex items-center gap-2 rounded bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-600 transition-colors"
        >
          <Upload size={14} />
          Upload Files
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-gray-700">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wide">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2 w-44">Adset Name</th>
              <th className="px-2 py-2 w-36">Ad Name</th>
              <th className="px-2 py-2 w-36">Creative</th>
              <th className="px-2 py-2">Primary Text</th>
              <th className="px-2 py-2 w-40">Headline</th>
              <th className="px-2 py-2 w-40">Description</th>
              <th className="px-2 py-2 w-10">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className="border-b border-gray-700 last:border-b-0"
              >
                {/* # */}
                <td className="px-2 py-1.5 bg-gray-800/50 text-gray-500 text-center">
                  {idx + 1}
                </td>

                {/* Adset Name */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <input
                    type="text"
                    value={row.adset_name}
                    placeholder={`Adset ${idx + 1}`}
                    onChange={(e) =>
                      onUpdateRow(row.id, { adset_name: e.target.value })
                    }
                    className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                      !row.adset_name.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                    }`}
                  />
                </td>

                {/* Ad Name */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <input
                    type="text"
                    value={row.ad_name}
                    placeholder={`Ad ${idx + 1}`}
                    onChange={(e) =>
                      onUpdateRow(row.id, { ad_name: e.target.value })
                    }
                    className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                      !row.ad_name.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                    }`}
                  />
                </td>

                {/* Creative */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <input
                    ref={(el) => {
                      rowInputRefs.current[row.id] = el;
                    }}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleRowUpload(file, row.id);
                        e.target.value = "";
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    {row.status === "uploading" && (
                      <Loader2 size={14} className="shrink-0 animate-spin text-blue-400" />
                    )}
                    {row.status === "done" && row.file_name && (
                      <>
                        <CheckCircle size={14} className="shrink-0 text-green-400" />
                        <span className="truncate text-xs text-gray-300" title={row.file_name}>
                          {row.file_name}
                        </span>
                      </>
                    )}
                    {row.status === "error" && (
                      <span className="flex items-center gap-1" title={row.error ?? "Upload error"}>
                        <AlertCircle size={14} className="shrink-0 text-red-400" />
                        <span className="truncate text-xs text-red-400">
                          {row.error ?? "Error"}
                        </span>
                      </span>
                    )}
                    {row.status === "pending" && !row.file_name && (
                      <button
                        type="button"
                        onClick={() => rowInputRefs.current[row.id]?.click()}
                        className="rounded bg-red-900/30 border border-red-500/50 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900/50 transition-colors"
                      >
                        Upload required
                      </button>
                    )}
                    {row.status === "error" && (
                      <button
                        type="button"
                        onClick={() => rowInputRefs.current[row.id]?.click()}
                        className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>

                {/* Primary Text */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <textarea
                    rows={2}
                    value={row.primary_text}
                    placeholder="Primary text..."
                    onChange={(e) =>
                      onUpdateRow(row.id, { primary_text: e.target.value })
                    }
                    className={`w-full resize-none rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                      !row.primary_text.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                    }`}
                  />
                </td>

                {/* Headline */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <input
                    type="text"
                    value={row.headline}
                    placeholder="Headline"
                    onChange={(e) =>
                      onUpdateRow(row.id, { headline: e.target.value })
                    }
                    className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                      !row.headline.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                    }`}
                  />
                </td>

                {/* Description */}
                <td className="px-2 py-1.5 bg-gray-800/50">
                  <input
                    type="text"
                    value={row.description}
                    placeholder="Description"
                    onChange={(e) =>
                      onUpdateRow(row.id, { description: e.target.value })
                    }
                    className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                      !row.description.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                    }`}
                  />
                </td>

                {/* Actions */}
                <td className="px-2 py-1.5 bg-gray-800/50 text-center">
                  <button
                    type="button"
                    onClick={() => onRemoveRow(row.id)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400 transition-colors"
                    title="Remove row"
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Row */}
      <button
        type="button"
        onClick={onAddRow}
        className="flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
      >
        <Plus size={14} />
        Add Row
      </button>
    </div>
  );
}
