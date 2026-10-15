"use client";

import { useRef, useCallback, useState } from "react";
import {
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Film,
  Image as ImageIcon,
} from "lucide-react";
import { PresetPicker } from "./preset-picker";
import {
  baseFileName,
  groupRows,
  hasCreative,
  makeEmptyRow,
  resolveCopy,
  type AdSetGroup,
  type BulkAdRow,
  type DefaultCopy,
} from "./types";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// ── Types ────────────────────────────────────────────────────────────────────

interface AdRowsTableProps {
  rows: BulkAdRow[];
  adAccountId: string;
  // Enables per-field Preset picker (ad name / primary text / headline /
  // description). Null disables the picker with a hint to select a store.
  shopifyStoreId?: string | null;
  // False when every ad is going into one ad set the user already picked —
  // there are no ad sets to name or group by.
  showAdsetName?: boolean;
  // Section B's ad set name; a blank ad set name falls back to "<prefix> - N".
  adsetNamePrefix: string;
  // Shared copy that blank copy fields fall back to.
  defaultCopy: DefaultCopy;
  // Outline missing fields in red — only once the user tried to submit.
  showErrors: boolean;
  onUpdateRow: (id: string, updates: Partial<BulkAdRow>) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  // Adds rows, each placed at the end of its ad set (new ad sets go last).
  onAddRows: (rows: BulkAdRow[]) => void;
  onRemoveRow: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
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

// Where picked files should go: one ad's creative, more ads in one ad set,
// or (top-level upload) empty ads first, then a new ad set per file.
type UploadTarget =
  | { kind: "row"; rowId: string }
  | { kind: "group"; groupId: string }
  | { kind: "new" };

interface PlannedUpload {
  file: File;
  rowId: string;
}

const ACCEPT = "image/*,video/*";

export function AdRowsTable({
  rows,
  adAccountId,
  shopifyStoreId,
  showAdsetName = true,
  adsetNamePrefix,
  defaultCopy,
  showErrors,
  onUpdateRow,
  onRenameGroup,
  onAddRows,
  onRemoveRow,
  onRemoveGroup,
}: AdRowsTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget>({ kind: "new" });

  const groups = showAdsetName
    ? groupRows(rows)
    : // Everything goes into the one ad set picked above.
      [{ group_id: rows[rows.length - 1]?.group_id ?? "", adset_name: "", rows }];

  // Upload a single file for a given row — detect type from file MIME
  const uploadFileForRow = useCallback(
    async (file: File, rowId: string, token: string) => {
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

  // Pair files with ads (creating ads where needed), show the local preview
  // straight away, then upload to Facebook three at a time.
  const handleFiles = useCallback(
    async (files: File[], target: UploadTarget) => {
      if (files.length === 0) return;

      const planned: PlannedUpload[] = [];
      const newRows: BulkAdRow[] = [];
      const startRow = (row: BulkAdRow, file: File) => {
        if (row.preview_url) URL.revokeObjectURL(row.preview_url);
        onUpdateRow(row.id, {
          status: "uploading",
          error: null,
          image_hash: null,
          video_id: null,
          file_name: file.name,
          creative_type: file.type.startsWith("video/") ? "video" : "image",
          preview_url: URL.createObjectURL(file),
          ...(row.ad_name.trim() ? {} : { ad_name: baseFileName(file.name) }),
        });
        planned.push({ file, rowId: row.id });
      };
      const newRow = (file: File, groupId?: string, adsetName?: string) => {
        const row = {
          ...makeEmptyRow(groupId, adsetName),
          status: "uploading" as const,
          file_name: file.name,
          creative_type: file.type.startsWith("video/")
            ? ("video" as const)
            : ("image" as const),
          preview_url: URL.createObjectURL(file),
          ad_name: baseFileName(file.name),
        };
        newRows.push(row);
        planned.push({ file, rowId: row.id });
      };

      if (target.kind === "row") {
        const row = rows.find((r) => r.id === target.rowId);
        if (row) startRow(row, files[0]);
      } else {
        const scope =
          target.kind === "group" && showAdsetName
            ? rows.filter((r) => r.group_id === target.groupId)
            : rows;
        const empty = scope.filter(
          (r) => !hasCreative(r) && r.status !== "uploading",
        );
        const group =
          target.kind === "group" ? scope[scope.length - 1] : undefined;
        files.forEach((file, i) => {
          if (empty[i]) startRow(empty[i], file);
          else if (target.kind === "group" || !showAdsetName)
            newRow(file, group?.group_id ?? rows[rows.length - 1]?.group_id, group?.adset_name);
          else newRow(file);
        });
      }

      if (newRows.length > 0) onAddRows(newRows);

      let token: string;
      try {
        token = await fetchToken();
      } catch {
        for (const p of planned)
          onUpdateRow(p.rowId, { status: "error", error: "Failed to fetch token" });
        return;
      }

      await runWithConcurrency(
        planned.map((p) => () => uploadFileForRow(p.file, p.rowId, token)),
        3,
      );
    },
    [rows, showAdsetName, onUpdateRow, onAddRows, uploadFileForRow],
  );

  const pickFiles = (target: UploadTarget) => {
    const input = fileInputRef.current;
    if (!input) return;
    uploadTargetRef.current = target;
    input.multiple = target.kind !== "row";
    input.click();
  };

  const adCount = rows.length;
  const groupCount = showAdsetName ? groups.length : 1;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          handleFiles(files, uploadTargetRef.current);
        }}
      />

      {/* Summary + bulk upload */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          {showAdsetName ? (
            <>
              <span className="text-white font-medium">{groupCount}</span>{" "}
              {groupCount === 1 ? "ad set" : "ad sets"} ·{" "}
            </>
          ) : null}
          <span className="text-white font-medium">{adCount}</span>{" "}
          {adCount === 1 ? "ad" : "ads"}
        </p>
        {showAdsetName && (
          <button
            type="button"
            onClick={() => pickFiles({ kind: "new" })}
            title="Fills ads that have no creative yet, then adds a new ad set for each extra file"
            className="flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-600 transition-colors cursor-pointer"
          >
            <Upload size={14} />
            Upload creatives — 1 ad set each
          </button>
        )}
      </div>

      {groups.map((group, gi) => (
        <AdSetCard
          key={group.group_id || "all"}
          group={group}
          number={gi + 1}
          showAdsetName={showAdsetName}
          adsetNamePrefix={adsetNamePrefix}
          defaultCopy={defaultCopy}
          showErrors={showErrors}
          shopifyStoreId={shopifyStoreId ?? null}
          onUpdateRow={onUpdateRow}
          onRenameGroup={onRenameGroup}
          onRemoveRow={onRemoveRow}
          onRemoveGroup={onRemoveGroup}
          onAddAd={() =>
            onAddRows([makeEmptyRow(group.group_id || undefined, group.adset_name)])
          }
          onPickFiles={pickFiles}
          onDropFiles={handleFiles}
        />
      ))}

      {showAdsetName && (
        <button
          type="button"
          onClick={() => onAddRows([makeEmptyRow()])}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-600 py-3 text-sm text-gray-400 hover:border-gray-500 hover:text-white transition-colors cursor-pointer"
        >
          <Plus size={14} />
          Add ad set
        </button>
      )}
    </div>
  );
}

// ── Ad set card ──────────────────────────────────────────────────────────────

function AdSetCard({
  group,
  number,
  showAdsetName,
  adsetNamePrefix,
  defaultCopy,
  showErrors,
  shopifyStoreId,
  onUpdateRow,
  onRenameGroup,
  onRemoveRow,
  onRemoveGroup,
  onAddAd,
  onPickFiles,
  onDropFiles,
}: {
  group: AdSetGroup;
  number: number;
  showAdsetName: boolean;
  adsetNamePrefix: string;
  defaultCopy: DefaultCopy;
  showErrors: boolean;
  shopifyStoreId: string | null;
  onUpdateRow: (id: string, updates: Partial<BulkAdRow>) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onRemoveRow: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onAddAd: () => void;
  onPickFiles: (target: UploadTarget) => void;
  onDropFiles: (files: File[], target: UploadTarget) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fallbackName = `${adsetNamePrefix.trim() || "Ad set"} - ${number}`;
  const count = group.rows.length;

  return (
    <section
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onDropFiles(Array.from(e.dataTransfer.files), {
          kind: "group",
          groupId: group.group_id,
        });
      }}
      className={`rounded-xl border bg-gray-800/40 transition-colors ${
        dragging ? "border-blue-500 bg-blue-500/5" : "border-gray-700"
      }`}
    >
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-700/60 px-4 py-3">
        {showAdsetName ? (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Ad set {number}
            </span>
            <input
              type="text"
              value={group.adset_name}
              placeholder={fallbackName}
              onChange={(e) => onRenameGroup(group.group_id, e.target.value)}
              title={`Leave blank to name it "${fallbackName}"`}
              className="min-w-0 flex-1 basis-56 rounded-lg border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </>
        ) : (
          <span className="text-sm text-gray-300">
            Going into the ad set selected in Setup
          </span>
        )}
        <span className="text-xs text-gray-500">
          {count} {count === 1 ? "ad" : "ads"}
        </span>
        {showAdsetName && (
          <button
            type="button"
            onClick={() => onRemoveGroup(group.group_id)}
            className="ml-auto rounded p-1.5 text-gray-500 hover:bg-gray-700 hover:text-red-400 transition-colors cursor-pointer"
            title="Remove this ad set and its ads"
          >
            <Trash2 size={14} />
          </button>
        )}
      </header>

      {/* Ads */}
      <div className="space-y-3 p-4">
        {group.rows.map((row, ai) => (
          <AdCard
            key={row.id}
            row={row}
            number={ai + 1}
            defaultCopy={defaultCopy}
            showErrors={showErrors}
            shopifyStoreId={shopifyStoreId}
            onUpdate={(updates) => onUpdateRow(row.id, updates)}
            onRemove={() => onRemoveRow(row.id)}
            onPickFile={() => onPickFiles({ kind: "row", rowId: row.id })}
            onDropFile={(file) =>
              onDropFiles([file], { kind: "row", rowId: row.id })
            }
          />
        ))}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddAd}
            className="flex items-center gap-1.5 rounded-lg bg-gray-700/70 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600 transition-colors cursor-pointer"
          >
            <Plus size={13} />
            Add ad{showAdsetName ? " to this ad set" : ""}
          </button>
          <button
            type="button"
            onClick={() =>
              onPickFiles({ kind: "group", groupId: group.group_id })
            }
            className="flex items-center gap-1.5 rounded-lg bg-gray-700/70 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600 transition-colors cursor-pointer"
          >
            <Upload size={13} />
            Upload creatives{showAdsetName ? " into this ad set" : ""}
          </button>
          <span className="self-center text-[11px] text-gray-600">
            or drop files on this card
          </span>
        </div>
      </div>
    </section>
  );
}

// ── Ad card ──────────────────────────────────────────────────────────────────

const inputBase =
  "w-full rounded-lg border bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none";

function inputClass(invalid: boolean) {
  return `${inputBase} ${
    invalid
      ? "border-red-500/60 focus:border-red-500"
      : "border-gray-600 focus:border-blue-500"
  }`;
}

function Field({
  label,
  preset,
  className = "",
  children,
}: {
  label: string;
  preset?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex h-5 items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        {preset}
      </div>
      {children}
    </div>
  );
}

// Placeholder for a copy field: shows the shared default it will fall back to.
function copyPlaceholder(fallback: string, empty: string) {
  const text = fallback.trim();
  if (!text) return empty;
  return `Default: ${text.replace(/\s+/g, " ")}`;
}

function AdCard({
  row,
  number,
  defaultCopy,
  showErrors,
  shopifyStoreId,
  onUpdate,
  onRemove,
  onPickFile,
  onDropFile,
}: {
  row: BulkAdRow;
  number: number;
  defaultCopy: DefaultCopy;
  showErrors: boolean;
  shopifyStoreId: string | null;
  onUpdate: (updates: Partial<BulkAdRow>) => void;
  onRemove: () => void;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
}) {
  const copy = resolveCopy(row, defaultCopy);
  const missing = {
    ad_name: !row.ad_name.trim(),
    creative: !hasCreative(row) && row.status !== "uploading",
    primary_text: !copy.primary_text.trim(),
    headline: !copy.headline.trim(),
    description: !copy.description.trim(),
  };
  // A failed submit leaves status "error" on an ad that has its creative.
  const submitError = row.status === "error" && hasCreative(row) ? row.error : null;

  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-gray-900/40 p-3">
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400 transition-colors cursor-pointer"
        title="Remove this ad"
      >
        <X size={14} />
      </button>

      <div className="flex flex-col gap-4 sm:flex-row">
        <CreativeTile
          row={row}
          invalid={showErrors && missing.creative}
          onPick={onPickFile}
          onDrop={onDropFile}
        />

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 pr-6 md:grid-cols-2">
          <Field
            label={`Ad ${number} name`}
            className="md:col-span-2"
            preset={
              <PresetPicker
                kind="ad_name"
                storeId={shopifyStoreId}
                currentValue={row.ad_name}
                onApply={(content) => onUpdate({ ad_name: content.slice(0, 80) })}
              />
            }
          >
            <input
              type="text"
              value={row.ad_name}
              placeholder="Ad name"
              onChange={(e) => onUpdate({ ad_name: e.target.value })}
              className={inputClass(showErrors && missing.ad_name)}
            />
          </Field>

          <Field
            label="Primary text"
            className="md:col-span-2"
            preset={
              <PresetPicker
                kind="primary_text"
                storeId={shopifyStoreId}
                currentValue={row.primary_text}
                onApply={(content) => onUpdate({ primary_text: content })}
              />
            }
          >
            <textarea
              rows={3}
              value={row.primary_text}
              placeholder={copyPlaceholder(defaultCopy.primary_text, "Primary text…")}
              onChange={(e) => onUpdate({ primary_text: e.target.value })}
              className={`${inputClass(showErrors && missing.primary_text)} resize-y`}
            />
          </Field>

          <Field
            label="Headline"
            preset={
              <PresetPicker
                kind="headline"
                storeId={shopifyStoreId}
                currentValue={row.headline}
                onApply={(content) => onUpdate({ headline: content.slice(0, 255) })}
              />
            }
          >
            <input
              type="text"
              value={row.headline}
              placeholder={copyPlaceholder(defaultCopy.headline, "Headline")}
              onChange={(e) => onUpdate({ headline: e.target.value })}
              className={inputClass(showErrors && missing.headline)}
            />
          </Field>

          <Field
            label="Description"
            preset={
              <PresetPicker
                kind="description"
                storeId={shopifyStoreId}
                currentValue={row.description}
                onApply={(content) => onUpdate({ description: content })}
              />
            }
          >
            <input
              type="text"
              value={row.description}
              placeholder={copyPlaceholder(defaultCopy.description, "Description")}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className={inputClass(showErrors && missing.description)}
            />
          </Field>
        </div>
      </div>

      {submitError && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-red-900/20 px-2.5 py-1.5 text-xs text-red-300">
          <AlertCircle size={13} className="mt-px shrink-0" />
          Facebook: {submitError}
        </p>
      )}
    </div>
  );
}

// ── Creative tile ────────────────────────────────────────────────────────────

function CreativeTile({
  row,
  invalid,
  onPick,
  onDrop,
}: {
  row: BulkAdRow;
  invalid: boolean;
  onPick: () => void;
  onDrop: (file: File) => void;
}) {
  const uploading = row.status === "uploading";
  const uploaded = hasCreative(row);
  const uploadError = row.status === "error" && !uploaded;

  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) onDrop(file);
      }}
      title={
        uploaded
          ? `${row.file_name ?? "Creative"} — click to replace`
          : "Upload an image or video"
      }
      className={`group relative flex h-32 w-full shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border text-xs transition-colors cursor-pointer sm:w-32 ${
        uploadError || invalid
          ? "border-red-500/60 bg-red-900/10"
          : row.preview_url
          ? "border-gray-700 bg-gray-950"
          : "border-dashed border-gray-600 bg-gray-900 hover:border-gray-500"
      }`}
    >
      {row.preview_url &&
        (row.creative_type === "video" ? (
          <video
            src={row.preview_url}
            muted
            playsInline
            preload="metadata"
            className={`absolute inset-0 h-full w-full object-cover ${uploading ? "opacity-40" : ""}`}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.preview_url}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${uploading ? "opacity-40" : ""}`}
          />
        ))}

      {uploading ? (
        <span className="relative flex flex-col items-center gap-1 text-blue-300">
          <Loader2 size={18} className="animate-spin" />
          Uploading…
        </span>
      ) : uploadError ? (
        <span className="relative flex flex-col items-center gap-1 px-2 text-center text-red-300">
          <AlertCircle size={16} />
          <span className="line-clamp-2" title={row.error ?? undefined}>
            {row.error ?? "Upload failed"}
          </span>
          <span className="text-[11px] text-gray-400 underline">Try again</span>
        </span>
      ) : uploaded ? (
        <>
          {!row.preview_url && (
            <span className="relative flex flex-col items-center gap-1 px-2 text-center text-gray-300">
              {row.creative_type === "video" ? <Film size={18} /> : <ImageIcon size={18} />}
              <span className="line-clamp-2 break-all">{row.file_name}</span>
            </span>
          )}
          <span className="absolute left-1.5 top-1.5 rounded-full bg-gray-900/80 p-0.5">
            <CheckCircle size={14} className="text-green-400" />
          </span>
          <span className="absolute inset-x-0 bottom-0 bg-gray-900/80 py-1 text-center text-[11px] text-gray-200 opacity-0 transition-opacity group-hover:opacity-100">
            Replace
          </span>
        </>
      ) : (
        <span className="flex flex-col items-center gap-1 text-gray-400">
          <Upload size={18} />
          Image or video
        </span>
      )}
    </button>
  );
}
