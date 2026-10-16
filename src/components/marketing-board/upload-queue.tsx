"use client";

import { AlertTriangle, Check, Image as ImageIcon, Loader2, RotateCcw, Upload, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BoardItem, ItemKind } from "@/lib/marketing-board/types";
import { api } from "@/components/hook-studio/ui";
import { probeVideoFile, videoMimeOf } from "./video-probe";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** The bucket's limit for one file. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
/** Files uploading at once; the rest wait their turn. */
const CONCURRENCY = 3;

export type UploadStatus = "waiting" | "uploading" | "saving" | "done" | "failed";

export interface UploadRow {
  id: string;
  name: string;
  size: number;
  kind: ItemKind;
  status: UploadStatus;
  /** 0–100 while the file goes up. */
  progress: number;
  error: string | null;
}

/** Which tab a dropped file belongs on, and its type; null for anything else. */
export function uploadKindOf(file: File): { kind: ItemKind; mime: string } | null {
  if (IMAGE_TYPES.includes(file.type)) return { kind: "image", mime: file.type };
  const video = videoMimeOf(file);
  if (video) return { kind: "video", mime: video };
  if (!file.type || file.type === "application/octet-stream") {
    const img = IMAGE_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (img) return { kind: "image", mime: img };
  }
  return null;
}

type Signed = { path: string; token: string; bucket: string; url: string };
const sign = (body: Record<string, string>) => api<Signed>("/api/owner/marketing-board/upload-url", { method: "POST", body: JSON.stringify(body) });

/** PUT a file to a signed storage URL, reporting progress (fetch cannot). */
function put(url: string, body: Blob, mime: string, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("x-upsert", "false");
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status})`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = j.message || j.error || message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.send(body);
  });
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Board uploads as a queue: any number of files, three going up at a time,
 * each with its own progress and a retry if it fails. Videos and images go
 * to their own tab whichever tab is open. Every file lands in To do as its
 * own card, under the store filter that was set when it was added.
 */
export function useUploadQueue(onItem: (item: BoardItem) => void) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const files = useRef(new Map<string, { file: File; mime: string; store: string | undefined }>());
  const active = useRef(0);
  const waiting = useRef<Array<() => void>>([]);
  const onItemRef = useRef(onItem);
  useEffect(() => {
    onItemRef.current = onItem;
  }, [onItem]);

  const update = (id: string, patch: Partial<UploadRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active.current < CONCURRENCY) {
        active.current += 1;
        resolve();
      } else waiting.current.push(() => {
        active.current += 1;
        resolve();
      });
    });
  const release = () => {
    active.current -= 1;
    waiting.current.shift()?.();
  };

  const run = async (id: string, kind: ItemKind) => {
    const entry = files.current.get(id);
    if (!entry) return;
    const { file, mime, store } = entry;
    update(id, { status: "waiting", progress: 0, error: null });
    await acquire();
    try {
      update(id, { status: "uploading" });
      // Read the poster frame and length while the file goes up.
      const probe = kind === "video" ? probeVideoFile(file) : null;
      const target = await sign({ kind, mime });
      let shown = 0;
      await put(target.url, file, mime, (f) => {
        const pct = Math.floor(f * 100);
        if (pct >= shown + 2 || pct === 100) {
          shown = pct;
          update(id, { progress: pct });
        }
      });
      update(id, { status: "saving", progress: 100 });
      let body: Record<string, unknown> = { upload_path: target.path, name: file.name.replace(/\.[a-z0-9]+$/i, ""), store };
      if (probe) {
        const p = await probe;
        let thumbPath: string | null = null;
        if (p.thumb) {
          // A card without a poster still plays, so a failed poster never fails the upload.
          try {
            const t = await sign({ kind: "thumb", mime: "image/jpeg" });
            await put(t.url, p.thumb, "image/jpeg");
            thumbPath = t.path;
          } catch {}
        }
        body = { ...body, thumb_path: thumbPath, duration: p.duration, width: p.width, height: p.height };
      }
      const r = await api<{ item: BoardItem }>("/api/owner/marketing-board", { method: "POST", body: JSON.stringify(body) });
      onItemRef.current(r.item);
      files.current.delete(id);
      update(id, { status: "done" });
    } catch (e) {
      update(id, { status: "failed", error: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      release();
    }
  };

  /** Queue files; returns how many were taken and why the rest were skipped. */
  const add = (list: FileList | File[], store: string | undefined) => {
    const added: UploadRow[] = [];
    let wrongType = 0;
    let tooBig = 0;
    for (const file of Array.from(list)) {
      const k = uploadKindOf(file);
      if (!k) {
        wrongType += 1;
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        tooBig += 1;
        continue;
      }
      const id = crypto.randomUUID();
      files.current.set(id, { file, mime: k.mime, store });
      added.push({ id, name: file.name, size: file.size, kind: k.kind, status: "waiting", progress: 0, error: null });
    }
    if (added.length) {
      setRows((rs) => [...rs.filter((r) => r.status !== "done"), ...added]);
      for (const r of added) void run(r.id, r.kind);
    }
    return { added: added.length, wrongType, tooBig };
  };

  const retry = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row && files.current.has(id)) void run(id, row.kind);
  };
  const dismiss = (id: string) => {
    files.current.delete(id);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };
  const clear = () => {
    for (const r of rows) if (r.status === "done" || r.status === "failed") files.current.delete(r.id);
    setRows((rs) => rs.filter((r) => r.status !== "done" && r.status !== "failed"));
  };

  const busy = rows.some((r) => r.status === "waiting" || r.status === "uploading" || r.status === "saving");

  // Leaving mid-upload loses the files still going up; ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Once everything is up and nothing failed, tidy the list away.
  const failed = rows.some((r) => r.status === "failed");
  useEffect(() => {
    if (busy || failed || rows.length === 0) return;
    const t = setTimeout(() => setRows((rs) => rs.filter((r) => r.status !== "done")), 6000);
    return () => clearTimeout(t);
  }, [busy, failed, rows.length]);

  return { rows, add, retry, dismiss, clear, busy };
}

/**
 * Files dragged from the desktop anywhere over the page: shows the overlay
 * while they hover and hands them over on drop. Cards dragged between
 * columns carry no files, so they are left alone.
 */
export function useFileDrop(onFiles: (files: FileList) => void) {
  const [over, setOver] = useState(false);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setOver(true);
    };
    const overPage = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this the browser opens the file instead of dropping it here.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (e.dataTransfer?.files.length) onFilesRef.current(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overPage);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overPage);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return over;
}

export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none p-4">
      <div className="h-full w-full rounded-2xl border-4 border-dashed border-purple-400 bg-purple-950/70 flex flex-col items-center justify-center text-center gap-2">
        <Upload size={36} className="text-purple-200" />
        <p className="text-xl font-bold text-white">Drop to add to To do</p>
        <p className="text-sm text-purple-200">As many as you like. Videos go to Videos, images go to Images.</p>
        <p className="text-xs text-purple-300/80">MP4, MOV, WebM, PNG, JPG or WebP · up to 500 MB each</p>
      </div>
    </div>
  );
}

/** The queue, bottom right: each file's progress, retries for failures. */
export function UploadPanel({ rows, onRetry, onDismiss, onClear }: { rows: UploadRow[]; onRetry: (id: string) => void; onDismiss: (id: string) => void; onClear: () => void }) {
  if (rows.length === 0) return null;
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const pending = rows.length - done - failed;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-700 bg-gray-950 shadow-2xl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800">
        <p className="text-sm font-semibold text-white">
          {pending > 0 ? `Uploading · ${done} of ${rows.length} done` : failed ? `${done} added, ${failed} failed` : `${done} added to To do`}
        </p>
        {pending === 0 && (
          <button type="button" onClick={onClear} aria-label="Close" className="text-gray-400 hover:text-white cursor-pointer p-0.5">
            <X size={14} />
          </button>
        )}
      </div>
      <ul className="max-h-72 overflow-y-auto divide-y divide-gray-800/70">
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              {r.kind === "video" ? <Video size={12} className="text-gray-500 shrink-0" /> : <ImageIcon size={12} className="text-gray-500 shrink-0" />}
              <span className="flex-1 min-w-0 truncate text-gray-200" title={r.name}>
                {r.name}
              </span>
              <span className="text-gray-500 tabular-nums shrink-0">{fmtSize(r.size)}</span>
              {r.status === "done" && <Check size={13} className="text-green-400 shrink-0" />}
              {r.status === "saving" && <Loader2 size={13} className="text-gray-400 animate-spin shrink-0" />}
              {r.status === "failed" && (
                <>
                  <button type="button" onClick={() => onRetry(r.id)} aria-label={`Retry ${r.name}`} title="Retry" className="text-purple-300 hover:text-white cursor-pointer">
                    <RotateCcw size={13} />
                  </button>
                  <button type="button" onClick={() => onDismiss(r.id)} aria-label={`Remove ${r.name}`} title="Remove" className="text-gray-500 hover:text-white cursor-pointer">
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
            {(r.status === "uploading" || r.status === "waiting") && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-gray-800 overflow-hidden">
                  <div className="h-full bg-purple-500 transition-[width] duration-200" style={{ width: `${r.progress}%` }} />
                </div>
                <span className="text-[10px] text-gray-500 tabular-nums w-14 text-right">{r.status === "waiting" ? "waiting" : `${r.progress}%`}</span>
              </div>
            )}
            {r.status === "saving" && <p className="mt-1 text-[10px] text-gray-500">Making the card…</p>}
            {r.status === "failed" && (
              <p className="mt-1 text-[10px] text-red-300 flex items-start gap-1">
                <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {r.error}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
