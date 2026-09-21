"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileVideo,
  Loader2,
  Music,
  Mic,
  Play,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { TranscriberAnalysis } from "@/lib/gemini/transcriber";

const MAX_UPLOAD_MB = 500;
// Two at a time. Gemini's free tier throttles hard past that, and a stalled
// batch is slower than a steady one.
const CONCURRENCY = 2;

type JobStatus = "queued" | "uploading" | "analyzing" | "done" | "error";

interface Job {
  id: string;
  file: File;
  status: JobStatus;
  progress: number;
  error: string | null;
  analysis: TranscriberAnalysis | null;
  model: string | null;
  tokens: number | null;
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

interface UploadedRef {
  fileUri: string;
  fileName: string;
  mimeType: string;
}

// fetch() gives no upload progress, and a 200MB video with a dead progress bar
// looks frozen — hence XHR.
function putToGemini(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<UploadedRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl, true);
    xhr.setRequestHeader("X-Goog-Upload-Offset", "0");
    xhr.setRequestHeader("X-Goog-Upload-Command", "upload, finalize");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("BLOCKED"));
    xhr.onabort = () => reject(new Error("Cancelled"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status})`));
        return;
      }
      try {
        const uploaded = JSON.parse(xhr.responseText)?.file;
        if (!uploaded?.uri || !uploaded?.name) throw new Error("no uri");
        resolve({
          fileUri: uploaded.uri,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType ?? "video/mp4",
        });
      } catch {
        reject(new Error("Gemini returned an unreadable upload response"));
      }
    };

    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

async function uploadViaProxy(
  file: File,
  signal: AbortSignal
): Promise<UploadedRef> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/marketing/transcriber/proxy-upload", {
    method: "POST",
    body: form,
    signal,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Upload failed");
  return json as UploadedRef;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function toMarkdown(fileName: string, a: TranscriberAnalysis): string {
  const L: string[] = [];
  L.push(`# ${a.title || fileName}`);
  L.push(`\n**File:** ${fileName}  `);
  L.push(`**Language:** ${a.language}  `);
  L.push(`**Duration:** ${a.duration_seconds}s`);

  L.push(`\n## Transcript\n\n${a.transcript}`);
  if (a.clean_transcript) {
    L.push(`\n### Clean transcript\n\n${a.clean_transcript}`);
  }

  L.push(`\n## Tone of voice\n\n${a.overall_voice_tone}`);
  for (const s of a.speakers ?? []) {
    L.push(`\n### ${s.label}`);
    L.push(`- **Tone:** ${(s.tone ?? []).join(", ")}`);
    L.push(`- **Summary:** ${s.tone_summary}`);
    L.push(`- **Emotional arc:** ${s.emotional_arc}`);
    L.push(`- **Perceived:** ${s.perceived_gender}, ${s.perceived_age_range}`);
    L.push(`- **Language / accent:** ${s.language_and_accent}`);
    L.push(`- **Pace:** ${s.pace}`);
    L.push(`- **Pitch:** ${s.pitch}`);
    L.push(`- **Energy:** ${s.energy}`);
    L.push(`- **Texture:** ${s.texture}`);
    L.push(`- **Delivery:** ${s.delivery_style}`);
    L.push(`- **Recording:** ${s.recording_quality}`);
    L.push(`- **Casting note:** ${s.casting_note}`);
  }

  const m = a.music;
  L.push(`\n## Music`);
  if (!m?.present) {
    L.push(`\nNo music in this video.`);
  } else {
    L.push(`\n${m.summary}`);
    L.push(`\n- **Genre:** ${m.genre} — ${m.subgenre_or_style}`);
    L.push(`- **Mood:** ${(m.mood ?? []).join(", ")}`);
    L.push(`- **Instrumentation:** ${(m.instrumentation ?? []).join(", ")}`);
    L.push(`- **Tempo:** ${m.tempo_bpm}`);
    L.push(`- **Key / tonality:** ${m.key_or_tonality}`);
    L.push(`- **Rhythm & groove:** ${m.rhythm_and_groove}`);
    L.push(`- **Vocals:** ${m.vocals}`);
    L.push(`- **Production & era:** ${m.production_and_era}`);
    L.push(`- **Against the voice:** ${m.mix_relationship_to_voice}`);
    L.push(`- **Sounds like:** ${(m.sounds_like ?? []).join(" · ")}`);
    L.push(`- **Where to find one:** ${m.sourcing_guess}`);
    if (m.arrangement?.length) {
      L.push(`\n**Arrangement**`);
      for (const x of m.arrangement) L.push(`- \`${x.t}\` ${x.description}`);
    }
  }

  if (a.sound_design?.length) {
    L.push(`\n## Sound design`);
    for (const x of a.sound_design) L.push(`- \`${x.t}\` ${x.description}`);
  }
  if (a.audio_timeline?.length) {
    L.push(`\n## Audio timeline`);
    for (const x of a.audio_timeline) L.push(`- \`${x.t}\` ${x.description}`);
  }
  L.push(`\n## Read\n\n${a.audio_summary}`);
  return L.join("\n");
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy");
  }
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
        {label}
      </p>
      <p className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function Chips({ items, tone }: { items?: string[]; tone: "voice" | "music" }) {
  if (!items?.length) return null;
  const cls =
    tone === "voice"
      ? "bg-blue-500/10 text-blue-300 border-blue-500/20"
      : "bg-purple-500/10 text-purple-300 border-purple-500/20";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className={`px-2 py-0.5 rounded-full text-xs border ${cls}`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function TimeList({ items }: { items?: { t: string; description: string }[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="shrink-0 font-mono text-xs text-gray-500 pt-0.5 w-16">
            {x.t}
          </span>
          <span className="text-gray-300">{x.description}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center bg-gray-900/60">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white cursor-pointer hover:bg-white/5 transition-colors"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          {title}
        </button>
        {action && <div className="pr-3">{action}</div>}
      </div>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  return (
    <button
      onClick={() => copy(text, label)}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition-colors"
    >
      <Copy size={12} />
      Copy
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

function Result({ job }: { job: Job }) {
  const a = job.analysis!;
  const md = useMemo(() => toMarkdown(job.file.name, a), [job.file.name, a]);
  const m = a.music;

  return (
    <div className="space-y-3 p-4 bg-gray-950/40">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">
          {a.language} · {a.duration_seconds}s
          {job.model ? ` · ${job.model}` : ""}
          {job.tokens ? ` · ${job.tokens.toLocaleString()} tokens` : ""}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => copy(md, "Full report")}
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-700 px-2.5 py-1.5 rounded cursor-pointer hover:bg-white/5 transition-colors"
          >
            <Copy size={12} /> Copy all
          </button>
          <button
            onClick={() =>
              download(`${job.file.name.replace(/\.[^.]+$/, "")}.md`, md)
            }
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-700 px-2.5 py-1.5 rounded cursor-pointer hover:bg-white/5 transition-colors"
          >
            <Download size={12} /> .md
          </button>
        </div>
      </div>

      <Section
        title="Transcript"
        icon={<AudioLines size={14} className="text-emerald-400" />}
        action={<CopyBtn text={a.clean_transcript || a.transcript} label="Transcript" />}
      >
        <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
          {a.transcript}
        </pre>
        {a.clean_transcript && (
          <details className="text-sm">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
              Clean version (no timestamps)
            </summary>
            <p className="text-gray-300 whitespace-pre-wrap mt-2 leading-relaxed">
              {a.clean_transcript}
            </p>
          </details>
        )}
      </Section>

      <Section
        title="Tone of voice"
        icon={<Mic size={14} className="text-blue-400" />}
      >
        <p className="text-sm text-gray-200">{a.overall_voice_tone}</p>
        {(a.speakers ?? []).map((s, i) => (
          <div
            key={i}
            className="border-t border-gray-800 pt-4 space-y-3 first:border-0 first:pt-0"
          >
            <p className="text-sm font-medium text-white">{s.label}</p>
            <Chips items={s.tone} tone="voice" />
            <p className="text-sm text-gray-300">{s.tone_summary}</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Emotional arc" value={s.emotional_arc} />
              <Field label="Language & accent" value={s.language_and_accent} />
              <Field
                label="Perceived"
                value={[s.perceived_gender, s.perceived_age_range]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Field label="Delivery" value={s.delivery_style} />
              <Field label="Pace" value={s.pace} />
              <Field label="Pitch" value={s.pitch} />
              <Field label="Energy" value={s.energy} />
              <Field label="Texture" value={s.texture} />
              <Field label="Recording" value={s.recording_quality} />
              <Field label="Casting note" value={s.casting_note} />
            </div>
          </div>
        ))}
        {!a.speakers?.length && (
          <p className="text-sm text-gray-500">No speech in this video.</p>
        )}
      </Section>

      <Section
        title="Music"
        icon={<Music size={14} className="text-purple-400" />}
      >
        {!m?.present ? (
          <p className="text-sm text-gray-500">
            {m?.summary || "No music in this video."}
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-200">{m.summary}</p>
            <Chips items={m.mood} tone="music" />
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Genre" value={m.genre} />
              <Field label="Style" value={m.subgenre_or_style} />
              <Field label="Tempo" value={m.tempo_bpm} />
              <Field label="Key / tonality" value={m.key_or_tonality} />
              <Field label="Rhythm & groove" value={m.rhythm_and_groove} />
              <Field label="Vocals" value={m.vocals} />
              <Field label="Production & era" value={m.production_and_era} />
              <Field
                label="Against the voice"
                value={m.mix_relationship_to_voice}
              />
            </div>
            {!!m.instrumentation?.length && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                  Instrumentation
                </p>
                <Chips items={m.instrumentation} tone="music" />
              </div>
            )}
            {!!m.arrangement?.length && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                  Arrangement
                </p>
                <TimeList items={m.arrangement} />
              </div>
            )}
            {!!m.sounds_like?.length && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                  Sounds like
                </p>
                <ul className="space-y-1">
                  {m.sounds_like.map((s, i) => (
                    <li key={i} className="text-sm text-gray-300">
                      · {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field label="Where to find one" value={m.sourcing_guess} />
          </>
        )}
      </Section>

      {(!!a.sound_design?.length || !!a.audio_timeline?.length) && (
        <Section
          title="Timeline & sound design"
          icon={<Play size={14} className="text-amber-400" />}
          defaultOpen={false}
        >
          {!!a.sound_design?.length && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                Sound design
              </p>
              <TimeList items={a.sound_design} />
            </div>
          )}
          {!!a.audio_timeline?.length && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                Audio timeline
              </p>
              <TimeList items={a.audio_timeline} />
            </div>
          )}
        </Section>
      )}

      {a.audio_summary && (
        <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/40">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
            The read
          </p>
          <p className="text-sm text-gray-200">{a.audio_summary}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  analyzing: "Transcribing",
  done: "Done",
  error: "Failed",
};

export function TranscriberClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, next: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list).filter((f) =>
      f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name)
    );
    if (!incoming.length) {
      toast.error("Only video files (mp4, mov, webm).");
      return;
    }
    const tooBig = incoming.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`Over ${MAX_UPLOAD_MB}MB: ${tooBig.map((f) => f.name).join(", ")}`);
    }
    const ok = incoming.filter((f) => f.size <= MAX_UPLOAD_MB * 1024 * 1024);
    if (!ok.length) return;

    setJobs((prev) => [
      ...prev,
      ...ok.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: "queued" as JobStatus,
        progress: 0,
        error: null,
        analysis: null,
        model: null,
        tokens: null,
      })),
    ]);
  }, []);

  const runJob = useCallback(
    async (job: Job, signal: AbortSignal) => {
      patch(job.id, { status: "uploading", progress: 0, error: null });

      // 1. Mint an upload session, then push the bytes straight to Gemini.
      let uploaded: UploadedRef;
      const sessionRes = await fetch("/api/marketing/transcriber/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: job.file.name,
          mimeType: job.file.type || "video/mp4",
          sizeBytes: job.file.size,
        }),
        signal,
      });
      const sessionJson = await sessionRes.json();
      if (!sessionRes.ok) throw new Error(sessionJson?.error ?? "Upload refused");

      try {
        uploaded = await putToGemini(
          sessionJson.uploadUrl,
          job.file,
          (pct) => patch(job.id, { progress: pct }),
          signal
        );
      } catch (err) {
        // "BLOCKED" means the browser never reached Google — an extension, a
        // network policy, or no connection. Small files can go via our server.
        if (!(err instanceof Error) || err.message !== "BLOCKED") throw err;
        patch(job.id, { progress: 0 });
        uploaded = await uploadViaProxy(job.file, signal);
      }

      // 2. Gemini pre-processes, then transcribes and analyses.
      patch(job.id, { status: "analyzing", progress: 100 });
      const res = await fetch("/api/marketing/transcriber/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uploaded),
        signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Transcription failed");

      patch(job.id, {
        status: "done",
        analysis: json.analysis,
        model: json.model ?? null,
        tokens: json.tokens_used ?? null,
      });
      setExpanded((prev) => new Set(prev).add(job.id));
    },
    [patch]
  );

  const start = useCallback(async () => {
    const pending = jobs.filter(
      (j) => j.status === "queued" || j.status === "error"
    );
    if (!pending.length) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);

    // A fixed-size worker pool over a shared cursor — keeps CONCURRENCY videos
    // in flight without waiting for a whole batch to finish.
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length && !controller.signal.aborted) {
        const job = pending[cursor++];
        try {
          await runJob(job, controller.signal);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Something went wrong";
          patch(job.id, {
            status: "error",
            error: controller.signal.aborted ? "Cancelled" : message,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
    );

    setRunning(false);
    abortRef.current = null;
    if (!controller.signal.aborted) toast.success("Batch finished");
  }, [jobs, runJob, patch]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const remove = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const done = jobs.filter((j) => j.status === "done");
  const pendingCount = jobs.filter(
    (j) => j.status === "queued" || j.status === "error"
  ).length;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <AudioLines size={24} className="text-emerald-400" />
          Transcriber
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Drop in videos — get the transcript, the tone of voice, and a full
          breakdown of the music. Multiple files at a time.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-gray-700 hover:border-gray-600 bg-gray-900/30"
        }`}
      >
        <Upload size={28} className="mx-auto text-gray-500 mb-3" />
        <p className="text-white font-medium">
          Drop mp4 files here, or click to choose
        </p>
        <p className="text-gray-500 text-sm mt-1">
          mp4 · mov · webm — up to {MAX_UPLOAD_MB}MB each, as many as you want
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <button
              onClick={cancel}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors"
            >
              <X size={16} /> Stop
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!pendingCount}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors"
            >
              <Play size={16} />
              Transcribe {pendingCount || ""}
            </button>
          )}
          {done.length > 1 && (
            <button
              onClick={() =>
                download(
                  `transcripts-${new Date().toISOString().slice(0, 10)}.md`,
                  done
                    .map((j) => toMarkdown(j.file.name, j.analysis!))
                    .join("\n\n---\n\n")
                )
              }
              className="flex items-center gap-2 text-sm text-gray-300 hover:text-white border border-gray-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors"
            >
              <Download size={14} /> Download all ({done.length})
            </button>
          )}
          {!running && (
            <button
              onClick={() => setJobs([])}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors ml-auto"
            >
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Queue */}
      <div className="space-y-3">
        {jobs.map((job) => {
          const open = expanded.has(job.id);
          return (
            <div
              key={job.id}
              className="border border-gray-800 rounded-xl overflow-hidden bg-gray-900/40"
            >
              <div className="flex items-center gap-3 p-4">
                <FileVideo size={18} className="text-gray-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{job.file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(job.file.size / 1024 / 1024).toFixed(1)}MB ·{" "}
                    {STATUS_LABEL[job.status]}
                    {job.status === "uploading" ? ` ${job.progress}%` : ""}
                  </p>
                </div>

                {job.status === "uploading" && (
                  <div className="hidden sm:block w-32 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}
                {(job.status === "uploading" || job.status === "analyzing") && (
                  <Loader2 size={16} className="animate-spin text-emerald-400" />
                )}
                {job.status === "done" && (
                  <Check size={16} className="text-emerald-400" />
                )}
                {job.status === "error" && (
                  <TriangleAlert size={16} className="text-red-400" />
                )}

                {job.status === "done" && (
                  <button
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(job.id)) next.delete(job.id);
                        else next.add(job.id);
                        return next;
                      })
                    }
                    className="text-gray-400 hover:text-white cursor-pointer p-1"
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                )}
                {!running && (
                  <button
                    onClick={() => remove(job.id)}
                    className="text-gray-600 hover:text-red-400 cursor-pointer p-1"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {job.error && (
                <p className="px-4 pb-4 -mt-1 text-sm text-red-400">
                  {job.error}
                </p>
              )}
              {job.status === "done" && open && job.analysis && (
                <Result job={job} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
