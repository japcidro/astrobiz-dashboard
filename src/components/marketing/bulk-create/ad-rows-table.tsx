"use client";

import { useRef, useCallback } from "react";
import {
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
  CornerDownRight,
} from "lucide-react";
import { PresetPicker } from "./preset-picker";
import {
  existingAdsetLabel,
  makeEmptyRow,
  type BulkAdRow,
  type ExistingAdset,
} from "./types";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// ── Types ────────────────────────────────────────────────────────────────────

interface AdRowsTableProps {
  rows: BulkAdRow[];
  adAccountId: string;
  // Enables per-field Preset picker (ad name / primary text / headline /
  // description). Null disables the picker with a hint to select a store.
  shopifyStoreId?: string | null;
  // "Existing Ad Set" mode: the Adset Name column becomes a dropdown of
  // these ad sets, picked once per ad set group. Null means the ads create
  // their own ad sets and name them in the column instead.
  existingAdsets?: {
    adsets: ExistingAdset[];
    loading: boolean;
    error: string | null;
  } | null;
  // Per-ad-set budget column. Null hides it (CBO, or ads going into an
  // existing ad set); otherwise it says which kind and the default amount,
  // which a blank cell falls back to.
  budget: { kind: "daily" | "lifetime"; fallback: number | null } | null;
  onBudgetKindChange: (kind: "daily" | "lifetime") => void;
  onUpdateRow: (id: string, updates: Partial<BulkAdRow>) => void;
  // Sets the ad set name / budget / existing ad set on every ad in that ad set.
  onUpdateGroup: (
    groupId: string,
    updates: Partial<
      Pick<BulkAdRow, "adset_name" | "adset_budget" | "existing_adset_id">
    >
  ) => void;
  // Adds rows, each placed after the last ad of its ad set (new ad sets go
  // at the end).
  onAddRows: (rows: BulkAdRow[]) => void;
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
  shopifyStoreId,
  existingAdsets = null,
  budget,
  onBudgetKindChange,
  onUpdateRow,
  onUpdateGroup,
  onAddRows,
  onRemoveRow,
}: AdRowsTableProps) {
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const rowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Either column groups rows into ad sets; which one depends on the mode.
  const pickExisting = existingAdsets != null;
  const showAdsetName = !pickExisting;

  // "Apply to all rows": every ad set group that has not picked one yet.
  const applyAdsetToUnpicked = useCallback(
    (adsetId: string) => {
      const seen = new Set<string>();
      for (const r of rows) {
        if (r.existing_adset_id || seen.has(r.group_id)) continue;
        seen.add(r.group_id);
        onUpdateGroup(r.group_id, { existing_adset_id: adsetId });
      }
    },
    [rows, onUpdateGroup],
  );
  const unpickedGroups = new Set(
    rows.filter((r) => !r.existing_adset_id).map((r) => r.group_id),
  ).size;

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
    async (files: File[]) => {
      let token: string;
      try {
        token = await fetchToken();
      } catch {
        return;
      }

      // Pair files with rows by position; files past the last row get a new
      // row (and ad set) each. The new rows are built here so their ids are
      // known before state catches up.
      const newRows: BulkAdRow[] = [];
      const tasks: (() => Promise<void>)[] = [];
      for (let i = 0; i < files.length; i++) {
        let row = rows[i];
        if (!row) {
          row = makeEmptyRow();
          newRows.push(row);
        }
        const file = files[i];
        const rowId = row.id;
        tasks.push(() => uploadFileForRow(file, rowId, token));
      }
      if (newRows.length > 0) onAddRows(newRows);

      await runWithConcurrency(tasks, 3);
    },
    [rows, onAddRows, uploadFileForRow],
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
            // Copy the files out first: clearing the input below empties
            // the live FileList before the async upload gets to read it.
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) handleBulkUpload(files);
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
        {/* Wide enough that the copy fields stay usable; scrolls sideways
            on a narrow screen instead of squeezing them. */}
        <table className="w-full min-w-[1280px] text-sm text-left">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wide">
              <th className="px-2 py-2 w-8">#</th>
              {showAdsetName && (
                <th className="px-2 py-2 w-44">Adset Name</th>
              )}
              {pickExisting && (
                <th className="px-2 py-2 w-64">Existing Ad Set</th>
              )}
              {budget && (
                <th className="px-2 py-2 w-32">
                  <select
                    value={budget.kind}
                    onChange={(e) =>
                      onBudgetKindChange(e.target.value as "daily" | "lifetime")
                    }
                    title="Budget type for every ad set"
                    className="rounded bg-transparent text-xs uppercase tracking-wide text-gray-400 hover:text-white focus:outline-none cursor-pointer"
                  >
                    <option value="daily">Daily Budget</option>
                    <option value="lifetime">Lifetime Budget</option>
                  </select>
                </th>
              )}
              <th className="px-2 py-2 w-36">Ad Name</th>
              <th className="px-2 py-2 w-36">Creative</th>
              <th className="px-2 py-2 min-w-[300px]">Primary Text</th>
              <th className="px-2 py-2 w-40">Headline</th>
              <th className="px-2 py-2 w-40">Description</th>
              <th className="px-2 py-2 w-20 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              // An ad added with "+ Ad" sits right under the ad set's first
              // ad and shares its ad set, so it has no name of its own.
              const firstOfGroup = rows.findIndex((r) => r.group_id === row.group_id);
              const sharesAdset = firstOfGroup !== idx;
              const nextSharesAdset =
                rows[idx + 1]?.group_id === row.group_id;
              const pickedAdset = pickExisting
                ? existingAdsets.adsets.find((a) => a.id === row.existing_adset_id)
                : undefined;
              return (
              <tr
                key={row.id}
                className={`border-b last:border-b-0 ${
                  nextSharesAdset ? "border-gray-700/40 border-dashed" : "border-gray-700"
                }`}
              >
                {/* # */}
                <td className="px-2 py-1.5 bg-panel text-gray-500 text-center">
                  {idx + 1}
                </td>

                {/* Adset Name */}
                {showAdsetName && (
                  <td className="px-2 py-1.5 bg-panel">
                    {sharesAdset ? (
                      <span
                        className="flex items-center gap-1.5 pl-2 text-xs text-gray-500"
                        title={row.adset_name || undefined}
                      >
                        <CornerDownRight size={13} className="shrink-0" />
                        Same ad set as #{firstOfGroup + 1}
                      </span>
                    ) : (
                    <input
                      type="text"
                      value={row.adset_name}
                      placeholder={`Adset ${idx + 1}`}
                      onChange={(e) =>
                        onUpdateGroup(row.group_id, { adset_name: e.target.value })
                      }
                      className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                        !row.adset_name.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                      }`}
                    />
                    )}
                  </td>
                )}

                {/* Existing ad set — one per ad set group, on its first row */}
                {pickExisting && (
                  <td className="px-2 py-1.5 bg-panel align-top">
                    {sharesAdset ? (
                      <span
                        className="flex items-center gap-1.5 pl-2 py-1 text-xs text-gray-500"
                        title={pickedAdset ? existingAdsetLabel(pickedAdset) : undefined}
                      >
                        <CornerDownRight size={13} className="shrink-0" />
                        Same ad set as #{firstOfGroup + 1}
                      </span>
                    ) : existingAdsets.loading ? (
                      <span className="flex items-center gap-1.5 py-1 text-xs text-gray-500">
                        <Loader2 size={12} className="animate-spin" />
                        Loading ad sets...
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <select
                          value={row.existing_adset_id ?? ""}
                          onChange={(e) =>
                            onUpdateGroup(row.group_id, {
                              existing_adset_id: e.target.value || null,
                            })
                          }
                          title={pickedAdset ? existingAdsetLabel(pickedAdset) : undefined}
                          className={`w-full rounded border bg-gray-900 px-2 py-1 text-sm focus:outline-none ${
                            row.existing_adset_id
                              ? "border-gray-600 text-white focus:border-blue-500"
                              : "border-red-500/50 text-gray-500 focus:border-red-500"
                          }`}
                        >
                          <option value="">
                            {existingAdsets.adsets.length === 0
                              ? "No ad sets in this campaign"
                              : "Select ad set..."}
                          </option>
                          {existingAdsets.adsets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {existingAdsetLabel(a)}
                            </option>
                          ))}
                        </select>
                        {pickedAdset && pickedAdset.effective_status !== "ACTIVE" && (
                          <p className="text-[11px] text-yellow-400">
                            Ad set is {pickedAdset.effective_status.replace(/_/g, " ").toLowerCase()} —
                            the ads will sit there until you turn it on.
                          </p>
                        )}
                        {row.existing_adset_id && unpickedGroups > 0 && (
                          <button
                            type="button"
                            onClick={() => applyAdsetToUnpicked(row.existing_adset_id!)}
                            className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                            title="Use this ad set on every row that has not picked one"
                          >
                            Apply to all rows
                          </button>
                        )}
                        {existingAdsets.error && (
                          <p className="text-[11px] text-red-400">{existingAdsets.error}</p>
                        )}
                      </div>
                    )}
                  </td>
                )}

                {/* Budget — one per ad set, on its first row */}
                {budget && (
                  <td className="px-2 py-1.5 bg-panel">
                    {!sharesAdset && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">₱</span>
                        <input
                          type="number"
                          min="1"
                          value={row.adset_budget ?? ""}
                          placeholder={
                            budget.fallback != null ? String(budget.fallback) : "Budget"
                          }
                          title={
                            budget.fallback != null
                              ? `Leave blank for ₱${budget.fallback}`
                              : undefined
                          }
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            onUpdateGroup(row.group_id, {
                              adset_budget: Number.isFinite(val) && val > 0 ? val : null,
                            });
                          }}
                          className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </td>
                )}

                {/* Ad Name */}
                <td className="px-2 py-1.5 bg-panel">
                  <div className="space-y-1">
                    <div className="flex items-center justify-end">
                      <PresetPicker
                        kind="ad_name"
                        storeId={shopifyStoreId ?? null}
                        currentValue={row.ad_name}
                        onApply={(content) =>
                          onUpdateRow(row.id, {
                            ad_name: content.slice(0, 80),
                          })
                        }
                      />
                    </div>
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
                  </div>
                </td>

                {/* Creative */}
                <td className="px-2 py-1.5 bg-panel">
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
                  <div className="space-y-1">
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
                  </div>
                </td>

                {/* Primary Text */}
                <td className="px-2 py-1.5 bg-panel">
                  <div className="space-y-1">
                    <div className="flex items-center justify-end">
                      <PresetPicker
                        kind="primary_text"
                        storeId={shopifyStoreId ?? null}
                        currentValue={row.primary_text}
                        onApply={(content) =>
                          onUpdateRow(row.id, { primary_text: content })
                        }
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={row.primary_text}
                      placeholder="Primary text..."
                      onChange={(e) =>
                        onUpdateRow(row.id, { primary_text: e.target.value })
                      }
                      className={`w-full resize-y rounded border bg-gray-900 px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none ${
                        !row.primary_text.trim() ? "border-red-500/50 focus:border-red-500" : "border-gray-600 focus:border-blue-500"
                      }`}
                    />
                  </div>
                </td>

                {/* Headline */}
                <td className="px-2 py-1.5 bg-panel">
                  <div className="space-y-1">
                    <div className="flex items-center justify-end">
                      <PresetPicker
                        kind="headline"
                        storeId={shopifyStoreId ?? null}
                        currentValue={row.headline}
                        onApply={(content) =>
                          onUpdateRow(row.id, {
                            headline: content.slice(0, 255),
                          })
                        }
                      />
                    </div>
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
                  </div>
                </td>

                {/* Description */}
                <td className="px-2 py-1.5 bg-panel">
                  <div className="space-y-1">
                    <div className="flex items-center justify-end">
                      <PresetPicker
                        kind="description"
                        storeId={shopifyStoreId ?? null}
                        currentValue={row.description}
                        onApply={(content) =>
                          onUpdateRow(row.id, { description: content })
                        }
                      />
                    </div>
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
                  </div>
                </td>

                {/* Actions */}
                <td className="px-2 py-1.5 bg-panel text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onAddRows([
                          makeEmptyRow(
                            row.group_id,
                            row.adset_name,
                            row.adset_budget,
                            row.existing_adset_id,
                          ),
                        ])
                      }
                      className="flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
                      title="Add another ad to this ad set"
                    >
                      <Plus size={12} />
                      Ad
                    </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRow(row.id)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400 transition-colors"
                    title="Remove row"
                  >
                    <X size={14} />
                  </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Row */}
      <button
        type="button"
        onClick={() => onAddRows([makeEmptyRow()])}
        className="flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
      >
        <Plus size={14} />
        Add Row
      </button>

    </div>
  );
}
