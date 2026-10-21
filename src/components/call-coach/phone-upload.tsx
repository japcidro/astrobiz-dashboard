"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileAudio, RefreshCw, Smartphone, Trash2, UploadCloud, XCircle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Pill, type PillTone } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { PHONE_UPLOAD_ACCEPT, PHONE_UPLOAD_MAX_BYTES, formatClock, phoneUploadMime } from "@/lib/call-coach/shared";
import type { PhoneUploadRow } from "@/app/api/call-coach/uploads/route";

/**
 * Upload from phone: the VA picks call recordings from her phone's recorder
 * app, sets when each call started and the order it was for, and the files
 * go straight to the private bucket (a signed URL per file, so a long call
 * never passes through a Vercel function). Each one is then registered as a
 * Call Coach segment and takes the same path as a PC-mic minute.
 */

type Status = "ready" | "uploading" | "registering" | "done" | "duplicate" | "failed";

interface Item {
  key: string;
  file: File;
  mime: string | null;
  /** Seconds, from the phone's own decoder; null when the browser cannot play the format (AMR). */
  duration: number | null;
  /** The datetime-local value, in the phone's own clock. */
  startedAt: string;
  reference: string;
  status: Status;
  progress: number;
  error: string | null;
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};

/** The clip's length from the phone's decoder; null when it will not play (AMR) or takes too long. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    let settled = false;
    const finish = (v: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    audio.src = url;
  });
}

function putFile(url: string, file: File, mime: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status})`;
      try {
        const json = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = json.message || json.error || message;
      } catch {
        /* not JSON */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error. Check your signal and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // A session that expired on the phone lands on the login page instead of JSON.
  if (res.redirected || (res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error("You are signed out. Sign in again, then tap Try again.");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const STATUS_PILL: Record<Status, { tone: PillTone; label: string }> = {
  ready: { tone: "neutral", label: "Ready" },
  uploading: { tone: "info", label: "Uploading" },
  registering: { tone: "info", label: "Saving" },
  done: { tone: "good", label: "Uploaded" },
  duplicate: { tone: "warn", label: "Already uploaded" },
  failed: { tone: "bad", label: "Failed" },
};

const SEGMENT_STATUS: Record<PhoneUploadRow["status"], { tone: PillTone; label: string }> = {
  stored: { tone: "neutral", label: "Waiting for transcript" },
  transcribed: { tone: "info", label: "Transcribed" },
  scored: { tone: "good", label: "Scored" },
  failed: { tone: "bad", label: "Transcription failed" },
};

export function PhoneUpload() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<PhoneUploadRow[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const patch = useCallback((key: string, changes: Partial<Item>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/call-coach/uploads", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { uploads?: PhoneUploadRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `Could not load (${res.status})`);
      setRecent(json.uploads ?? []);
      setRecentError(null);
    } catch (e) {
      setRecentError(e instanceof Error ? e.message : "Could not load your uploads");
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    const fresh: Item[] = picked.map((file) => {
      const mime = phoneUploadMime(file.name, file.type);
      const tooBig = file.size > PHONE_UPLOAD_MAX_BYTES;
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        mime,
        duration: null,
        startedAt: toLocalInput(file.lastModified || Date.now()),
        reference: "",
        status: !mime || tooBig ? "failed" : "ready",
        progress: 0,
        error: !mime
          ? "Not an audio file we can take. Use m4a, mp3, aac, ogg, amr, wav or webm."
          : tooBig
            ? `Too big (${formatBytes(file.size)}); the limit is ${PHONE_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`
            : null,
      };
    });
    setItems((list) => [...list, ...fresh]);
    // The recorder app saves the file when the call ends, so the file's time
    // is the end of the call; the start is that minus the length.
    for (const it of fresh) {
      if (it.status !== "ready") continue;
      const duration = await probeDuration(it.file);
      if (duration === null) continue;
      setItems((list) =>
        list.map((x) =>
          x.key === it.key ? { ...x, duration, startedAt: toLocalInput((x.file.lastModified || Date.now()) - duration * 1000) } : x,
        ),
      );
    }
  }, []);

  const uploadOne = useCallback(
    async (it: Item) => {
      const startedAt = new Date(it.startedAt);
      if (!it.mime || Number.isNaN(startedAt.getTime())) {
        patch(it.key, { status: "failed", error: "Set when the call started" });
        return;
      }
      patch(it.key, { status: "uploading", progress: 0, error: null });
      try {
        const signed = await postJson<{ path?: string; signed_url?: string; mime?: string; duplicate?: boolean }>("/api/call-coach/uploads/sign", {
          name: it.file.name,
          size: it.file.size,
          type: it.file.type,
          started_at: startedAt.toISOString(),
        });
        if (signed.duplicate) {
          patch(it.key, { status: "duplicate", progress: 1 });
          return;
        }
        if (!signed.path || !signed.signed_url || !signed.mime) throw new Error("Could not start the upload");
        await putFile(signed.signed_url, it.file, signed.mime, (f) => patch(it.key, { progress: f }));
        patch(it.key, { status: "registering", progress: 1 });
        await postJson<{ id: string }>("/api/call-coach/uploads", {
          path: signed.path,
          original_name: it.file.name,
          type: it.file.type,
          started_at: startedAt.toISOString(),
          duration_seconds: it.duration,
          reference: it.reference.trim() || null,
        });
        patch(it.key, { status: "done", progress: 1 });
      } catch (e) {
        patch(it.key, { status: "failed", error: e instanceof Error ? e.message : "Upload failed" });
      }
    },
    [patch],
  );

  const uploadAll = useCallback(async () => {
    setBusy(true);
    // One at a time: phone data is slow and a second stream only shares it.
    for (const it of items) {
      if (it.status === "ready") await uploadOne(it);
    }
    setBusy(false);
    void loadRecent();
  }, [items, uploadOne, loadRecent]);

  const retry = useCallback(
    async (it: Item) => {
      setBusy(true);
      await uploadOne({ ...it, status: "ready" });
      setBusy(false);
      void loadRecent();
    },
    [uploadOne, loadRecent],
  );

  const remove = (key: string) => setItems((list) => list.filter((it) => it.key !== key));

  const readyCount = items.filter((it) => it.status === "ready").length;
  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div className="space-y-5">
      <Panel title="Pick recordings" actions={items.length > 0 && <Pill tone="neutral">{items.length}</Pill>}>
        <input
          ref={inputRef}
          type="file"
          accept={PHONE_UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <label
          htmlFor={undefined}
          onClick={() => inputRef.current?.click()}
          className="grid cursor-pointer justify-items-center gap-2 rounded-panel border border-dashed border-line-strong px-4 py-7 text-center transition-colors hover:border-accent"
        >
          <FileAudio size={28} className="text-accent" aria-hidden />
          <span className="font-display text-sm text-fg">Tap to choose call recordings</span>
          <span className="text-xs text-muted">m4a, mp3, aac, ogg, amr, wav · up to {PHONE_UPLOAD_MAX_BYTES / 1024 / 1024} MB each · pick several at once</span>
        </label>

        {items.length > 0 && (
          <ul className="mt-4 space-y-3">
            {items.map((it) => {
              const pill = STATUS_PILL[it.status];
              const editable = it.status === "ready" || it.status === "failed";
              return (
                <li key={it.key} className="rounded-panel border border-line bg-canvas p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{it.file.name}</p>
                      <p className="text-xs text-muted">
                        {formatBytes(it.file.size)}
                        {it.duration !== null && ` · ${formatDuration(it.duration)}`}
                      </p>
                    </div>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                    {it.status !== "uploading" && it.status !== "registering" && (
                      <button type="button" onClick={() => remove(it.key)} aria-label="Remove" className="cursor-pointer text-dim hover:text-fg">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  {(it.status === "uploading" || it.status === "registering") && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-raised" role="progressbar" aria-valuenow={Math.round(it.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                    </div>
                  )}

                  {editable && it.mime && (
                    <div className="mt-3 grid gap-3">
                      <Field label="Call started" htmlFor={`${it.key}-at`} help={it.duration === null ? "From the file's time; fix it if the phone saved it later." : undefined}>
                        <Input
                          id={`${it.key}-at`}
                          type="datetime-local"
                          value={it.startedAt}
                          max={toLocalInput(Date.now())}
                          onChange={(e) => patch(it.key, { startedAt: e.target.value })}
                        />
                      </Field>
                      <Field label="Order number or customer phone" htmlFor={`${it.key}-ref`}>
                        <Input
                          id={`${it.key}-ref`}
                          inputMode="text"
                          autoComplete="off"
                          placeholder="e.g. 1234 or 09171234567"
                          value={it.reference}
                          maxLength={80}
                          onChange={(e) => patch(it.key, { reference: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}

                  {it.error && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-bad" role="alert">
                      <XCircle size={14} className="mt-px shrink-0" />
                      {it.error}
                    </p>
                  )}
                  {it.status === "done" && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-good">
                      <CheckCircle2 size={14} className="mt-px shrink-0" />
                      Saved. The transcript comes within the hour; the score the morning after.
                    </p>
                  )}
                  {it.status === "failed" && it.mime && it.file.size <= PHONE_UPLOAD_MAX_BYTES && (
                    <Button type="button" size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => void retry(it)}>
                      <RefreshCw size={14} /> Try again
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" size="lg" className="w-full sm:w-auto" disabled={busy || readyCount === 0} onClick={() => void uploadAll()}>
            <UploadCloud size={18} />
            {busy ? "Uploading…" : readyCount > 0 ? `Upload ${readyCount} ${readyCount === 1 ? "recording" : "recordings"}` : "Upload"}
          </Button>
          {doneCount > 0 && !busy && (
            <span className="text-xs text-muted">
              {doneCount} uploaded. You can close this page.
            </span>
          )}
        </div>
      </Panel>

      <Panel
        title="Your uploads, last 14 days"
        actions={
          <button type="button" onClick={() => void loadRecent()} className={cn(buttonClasses({ size: "sm", variant: "ghost" }))} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        }
      >
        {recentError && <p className="text-sm text-bad">{recentError}</p>}
        {recent && recent.length === 0 && (
          <EmptyState title="Nothing uploaded yet">Your phone recordings appear here with their status.</EmptyState>
        )}
        {recent && recent.length > 0 && (
          <ul className="divide-y divide-line">
            {recent.map((u) => {
              const st = SEGMENT_STATUS[u.status];
              const label = u.status === "scored" && u.reviewed ? "Scored · see My Calls" : st.label;
              return (
                <li key={u.id} className="flex items-start gap-3 py-2.5">
                  <Smartphone size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      <span className="font-num">{u.date}</span> <span className="font-num">{formatClock(u.started_at)}</span>
                      <span className="text-muted"> · {formatDuration(u.duration_seconds)}</span>
                      {u.reference && <span className="text-muted"> · {u.reference}</span>}
                    </p>
                    {u.original_name && <p className="truncate text-xs text-dim">{u.original_name}</p>}
                    {u.status === "failed" && u.transcribe_error && <p className="text-xs text-bad">{u.transcribe_error}</p>}
                  </div>
                  <Pill tone={st.tone}>{label}</Pill>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Where the recordings are on your phone">
        <ul className="space-y-2 text-sm text-fg">
          <li>
            <span className="text-muted">Android, Samsung:</span> open <strong>Voice Recorder</strong> or the Phone app&apos;s <strong>Call recordings</strong>; the files are in{" "}
            <span className="font-mono text-xs">Internal storage › Recordings › Call</span>. Tap <strong>Tap to choose</strong> above, then <strong>Browse</strong> or <strong>Files</strong> and open that folder.
          </li>
          <li>
            <span className="text-muted">Android, other recorder apps:</span> in the app, share or export the recording as <strong>m4a</strong> or <strong>mp3</strong> if it offers the choice. AMR files upload too, but m4a is safer.
          </li>
          <li>
            <span className="text-muted">iPhone:</span> in <strong>Voice Memos</strong> (or the call recording in <strong>Notes</strong>) tap Share › <strong>Save to Files</strong>, then choose it here from <strong>Files</strong>.
          </li>
          <li>
            <span className="text-muted">Tip:</span> i-upload agad pagkatapos ng calls, habang naka-WiFi, para tama ang oras at mabilis ang upload. Ilagay ang order number para madaling hanapin ang call.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
