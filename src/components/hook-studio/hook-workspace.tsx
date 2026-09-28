"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Sparkles, Trash2, UserRound, X, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ENGINES, DEFAULT_ENGINE, FACE_CREDITS, FACES_PER_BATCH, getEngine, remakeCredits, type EngineId, type Quality } from "@/lib/hook-studio/engines";
import { CREATORS, SCREEN_MODES, LANES } from "@/lib/hook-studio/presets";
import type { FaceView, HookView, JobView, WorkerStatus } from "@/lib/hook-studio/types";
import { Panel, Label, Chip, Button, Pill, credits, timeAgo, api } from "./ui";

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 20000;

export function HookWorkspace({
  id,
  worker,
  onBack,
}: {
  id: string;
  worker: WorkerStatus | null;
  onBack: () => void;
}) {
  const [hook, setHook] = useState<HookView | null>(null);
  const [faces, setFaces] = useState<FaceView[]>([]);
  const [prompt, setPrompt] = useState("");
  const [customText, setCustomText] = useState("");
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE);
  const [quality, setQuality] = useState<Quality>("standard");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  const promptDirty = useRef(false);
  const faceInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}`);
    setHook(h);
    if (!promptDirty.current) setPrompt(h.edit_prompt ?? "");
    return h;
  }, [id]);

  const loadFaces = useCallback(async () => {
    const r = await api<{ faces: FaceView[] }>("/api/owner/hook-studio/faces");
    setFaces(r.faces);
  }, []);

  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
    void loadFaces().catch(() => {});
  }, [load, loadFaces]);

  const pending = useMemo(
    () => (hook?.jobs ?? []).some((j) => j.status === "queued" || j.status === "running"),
    [hook]
  );

  useEffect(() => {
    const t = setInterval(() => void load().catch(() => {}), pending ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(t);
  }, [load, pending]);

  const patch = async (body: Record<string, unknown>) => {
    const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setHook(h);
    return h;
  };

  const savePrompt = async () => {
    try {
      setBusy("prompt");
      await patch({ edit_prompt: prompt });
      promptDirty.current = false;
      toast.success("Prompt saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async () => {
    try {
      setBusy("rewrite");
      const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}/prompt`, { method: "POST" });
      promptDirty.current = false;
      setHook(h);
      setPrompt(h.edit_prompt ?? "");
      toast.success("Claude rewrote the prompt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Claude failed");
    } finally {
      setBusy(null);
    }
  };

  const chooseText = (t: string | null) => patch({ chosen_text: t }).catch((e) => toast.error(e.message));

  const addCustomText = async () => {
    const t = customText.trim();
    if (!t || !hook) return;
    await patch({ text_options: [...hook.text_options, t], chosen_text: t }).catch((e) => toast.error(e.message));
    setCustomText("");
  };

  const queueRemakes = async () => {
    try {
      setBusy("remake");
      if (promptDirty.current) await patch({ edit_prompt: prompt });
      promptDirty.current = false;
      const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}/remakes`, {
        method: "POST",
        body: JSON.stringify({ engine, quality, count }),
      });
      setHook(h);
      toast.success(worker?.online ? `${count} remake${count > 1 ? "s" : ""} queued` : "Queued. It runs when the Mac is online.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue");
    } finally {
      setBusy(null);
    }
  };

  const again = async (j: JobView) => {
    try {
      const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}/remakes`, {
        method: "POST",
        body: JSON.stringify({ engine: j.engine_id, quality: j.quality ?? "standard", count: 1 }),
      });
      setHook(h);
      toast.success("Queued one more");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue");
    }
  };

  const cancel = async (j: JobView) => {
    try {
      await api(`/api/owner/hook-studio/jobs/${j.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    }
  };

  const generateFaces = async () => {
    try {
      setBusy("faces");
      setHook(await api<HookView>(`/api/owner/hook-studio/hooks/${id}/faces`, { method: "POST" }));
      toast.success(`${FACES_PER_BATCH} faces queued`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue faces");
    } finally {
      setBusy(null);
    }
  };

  const pinFromJob = async (j: JobView) => {
    try {
      const r = await api<{ id: string; faces: FaceView[] }>("/api/owner/hook-studio/faces", {
        method: "POST",
        body: JSON.stringify({ job_id: j.id }),
      });
      setFaces(r.faces);
      await patch({ face_id: r.id });
      toast.success("Face pinned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not pin");
    }
  };

  const uploadFace = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBusy("upload-face");
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>(
        "/api/owner/hook-studio/upload-url",
        { method: "POST", body: JSON.stringify({ kind: "face", mime: file.type }) }
      );
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const r = await api<{ id: string; faces: FaceView[] }>("/api/owner/hook-studio/faces", {
        method: "POST",
        body: JSON.stringify({ image_path: path, name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) }),
      });
      setFaces(r.faces);
      await patch({ face_id: r.id });
      toast.success("Photo pinned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (faceInput.current) faceInput.current.value = "";
    }
  };

  const unpinFace = async (f: FaceView) => {
    try {
      const r = await api<{ faces: FaceView[] }>("/api/owner/hook-studio/faces", { method: "DELETE", body: JSON.stringify({ id: f.id }) });
      setFaces(r.faces);
      if (hook?.face_id === f.id) await patch({ face_id: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };

  if (!hook) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  const eng = getEngine(engine)!;
  const total = remakeCredits(engine, quality, count);
  const remakes = hook.jobs.filter((j) => j.kind === "remake").slice().reverse();
  const faceJobs = hook.jobs.filter((j) => j.kind === "face");
  const canRemake = !!hook.edit_prompt?.trim() || !!prompt.trim();
  const needsFace = eng.needsFace && !hook.face;
  const laneLabel = LANES.find((l) => l.id === hook.lane)?.label ?? hook.lane;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button ghost onClick={onBack}>
            <ArrowLeft size={16} /> Library
          </Button>
          <div className="min-w-0">
            <p className="text-white font-semibold truncate">{hook.chosen_text || hook.brief.slice(0, 60) || "Untitled hook"}</p>
            <p className="text-xs text-gray-500">
              {laneLabel} · {hook.creator} · {hook.reference_name ?? "reference"} · {timeAgo(hook.created_at)}
            </p>
          </div>
        </div>
        <WorkerPill worker={worker} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        {/* Reference + brief */}
        <Panel>
          <div className="grid grid-cols-[140px_1fr] gap-4 items-start">
            {hook.reference_url ? (
              <video src={hook.reference_url} controls muted playsInline className="w-full aspect-[9/16] rounded-xl bg-black object-contain border border-gray-700" />
            ) : (
              <div className="w-full aspect-[9/16] rounded-xl bg-gray-900 border border-gray-700" />
            )}
            <div className="text-sm">
              <Label>Reference</Label>
              <p className="text-gray-300">
                Kept {Number(hook.trim_start)}s to {hook.trim_end ?? hook.reference_duration ?? "end"}s
                {hook.reference_duration ? ` of ${hook.reference_duration}s` : ""}. Silent.
              </p>
              <Label>Brief</Label>
              {!editingBrief ? (
                <>
                  <p className="text-gray-300 whitespace-pre-wrap">{hook.brief || <span className="text-gray-600">No brief.</span>}</p>
                  <p className="text-gray-500 text-xs mt-2">
                    {hook.creator} · {SCREEN_MODES.find((s) => s.id === hook.screen_mode)?.label}
                    {hook.face ? ` · pinned face: ${hook.face.name}` : ""}
                  </p>
                  <div className="mt-3">
                    <Button ghost onClick={() => setEditingBrief(true)}>Edit brief</Button>
                  </div>
                </>
              ) : (
                <BriefEditor
                  hook={hook}
                  onSave={async (body) => {
                    await patch(body).catch((e) => toast.error(e.message));
                    setEditingBrief(false);
                  }}
                  onCancel={() => setEditingBrief(false)}
                />
              )}
            </div>
          </div>
        </Panel>

        {/* Prompt + text */}
        <div className="rounded-xl border border-purple-500/40 bg-gradient-to-b from-purple-500/10 to-purple-500/[0.03] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-purple-300 font-bold flex items-center gap-1.5">
              <Sparkles size={12} /> Edit prompt
            </p>
            <div className="flex gap-1">
              <Button ghost onClick={rewrite} busy={busy === "rewrite"} title="Ask Claude again">
                <RefreshCw size={14} /> Rewrite
              </Button>
              <Button onClick={savePrompt} busy={busy === "prompt"} disabled={!promptDirty.current && prompt === (hook.edit_prompt ?? "")}>
                Save
              </Button>
            </div>
          </div>
          <textarea
            id="hook-edit-prompt"
            value={prompt}
            onChange={(e) => {
              promptDirty.current = true;
              setPrompt(e.target.value);
            }}
            rows={7}
            placeholder={busy === "rewrite" ? "Claude is writing…" : "No prompt yet. Press Rewrite."}
            className="mt-2 w-full bg-black/25 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white leading-relaxed placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <Label>On-screen text (preview only)</Label>
          <div className="flex flex-wrap gap-2">
            {hook.text_options.map((t) => (
              <Chip key={t} on={hook.chosen_text === t} onClick={() => chooseText(hook.chosen_text === t ? null : t)}>
                {t}
              </Chip>
            ))}
            {hook.text_options.length === 0 && <span className="text-xs text-gray-500">Options appear after the prompt is written.</span>}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              id="hook-custom-text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomText()}
              placeholder="Or type your own line"
              className="flex-1 bg-black/25 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <Button onClick={addCustomText} disabled={!customText.trim()}>Add</Button>
          </div>
        </div>
      </div>

      {/* Faces */}
      <Panel>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <UserRound size={15} /> Who is in the remake
              <span className="text-xs font-normal text-gray-500">pin a face for a real change of person. Without one, the engines keep the reference&apos;s face.</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={generateFaces} busy={busy === "faces"}>
              Generate {FACES_PER_BATCH} faces · {credits(FACE_CREDITS * FACES_PER_BATCH)}
            </Button>
            <Button ghost onClick={() => faceInput.current?.click()} busy={busy === "upload-face"}>
              <Upload size={14} /> Upload a photo
            </Button>
            <input ref={faceInput} id="hook-face-file" type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadFace(e.target.files?.[0])} />
          </div>
        </div>

        {(faces.length > 0 || faceJobs.length > 0) && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {faces.map((f) => {
              const on = hook.face_id === f.id;
              return (
                <div key={f.id} className={`relative rounded-xl overflow-hidden border-2 ${on ? "border-purple-500" : "border-transparent"}`}>
                  <button type="button" onClick={() => patch({ face_id: on ? null : f.id }).catch((e) => toast.error(e.message))} className="block w-full cursor-pointer">
                    {f.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL, no optimization wanted
                      <img src={f.image_url} alt={f.name} className="w-full aspect-[9/16] object-cover bg-gray-900" />
                    ) : (
                      <div className="w-full aspect-[9/16] bg-gray-900" />
                    )}
                  </button>
                  <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent text-[11px] text-white font-semibold flex justify-between">
                    <span className="truncate">{f.name}</span>
                    {on && <Check size={12} />}
                  </div>
                  <button type="button" onClick={() => unpinFace(f)} title="Unpin" className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-gray-300 hover:text-white cursor-pointer">
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {faceJobs
              .slice()
              .reverse()
              .map((j) => (
                <div key={j.id} className="relative rounded-xl overflow-hidden border-2 border-dashed border-gray-700">
                  {j.status === "done" && j.result_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, no optimization wanted */}
                      <img src={j.result_url} alt="candidate" className="w-full aspect-[9/16] object-cover bg-gray-900" />
                      <button type="button" onClick={() => pinFromJob(j)} className="absolute inset-x-1 bottom-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold py-1 cursor-pointer">
                        Pin
                      </button>
                    </>
                  ) : (
                    <div className="w-full aspect-[9/16] bg-gray-900 grid place-items-center text-[11px] text-gray-500 px-2 text-center">
                      {j.status === "failed" ? "Failed" : j.status === "running" ? "Rendering…" : j.status === "queued" ? "Queued" : j.status}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </Panel>

      {/* Remake */}
      <Panel>
        <Label>Engine</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEngine(e.id);
                if (!e.qualityLabels) setQuality("standard");
              }}
              className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                engine === e.id ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <p className="text-sm font-semibold text-white">{e.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{e.blurb}</p>
              <p className="text-xs font-mono text-gray-300 mt-1">
                {e.qualityLabels ? `${e.credits.standard} · ${e.credits.high} cr` : `${e.credits.standard} cr`} / remake
                {e.needsFace ? " · needs a face" : ""}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-4 flex-wrap">
          {eng.qualityLabels && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Quality</span>
              <Seg
                value={quality}
                options={[
                  ["standard", eng.qualityLabels.standard],
                  ["high", eng.qualityLabels.high],
                ]}
                onChange={(v) => setQuality(v as Quality)}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Remakes</span>
            <Seg value={String(count)} options={[["1", "1"], ["2", "2"], ["3", "3"]]} onChange={(v) => setCount(Number(v))} />
          </div>
          <Pill tone="muted">Sound: off, always</Pill>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500 max-w-lg">
            {needsFace
              ? `${eng.name} needs a pinned face. Generate or upload one above.`
              : !canRemake
                ? "Write or rewrite the edit prompt first."
                : worker && !worker.online
                  ? "The Mac worker is offline. Jobs queue now and run when it's back."
                  : "Renders on the Mac. You can leave this page; results appear below."}
          </p>
          <Button primary onClick={queueRemakes} busy={busy === "remake"} disabled={needsFace || !canRemake}>
            Remake ×{count} · {credits(total)}
          </Button>
        </div>
      </Panel>

      {/* Results */}
      {remakes.length > 0 && (
        <Panel>
          <Label>Remakes</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {remakes.map((j) => (
              <RemakeCard key={j.id} job={j} text={hook.chosen_text} onAgain={() => again(j)} onCancel={() => cancel(j)} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${value === v ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WorkerPill({ worker }: { worker: WorkerStatus | null }) {
  if (!worker) return null;
  return worker.online ? (
    <Pill tone="ok">
      Mac worker online{worker.credits !== null ? ` · ${credits(worker.credits)}` : ""}
      {worker.running > 0 ? ` · ${worker.running} rendering` : ""}
      {worker.queued > 0 ? ` · ${worker.queued} queued` : ""}
    </Pill>
  ) : (
    <Pill tone="warn">Mac worker offline{worker.last_seen ? ` · last seen ${timeAgo(worker.last_seen)}` : ""}</Pill>
  );
}

function RemakeCard({ job, text, onAgain, onCancel }: { job: JobView; text: string | null; onAgain: () => void; onCancel: () => void }) {
  const e = job.engine_id === "soul" ? null : getEngine(job.engine_id);
  const label = e?.name ?? job.engine;
  const q = e?.qualityLabels && job.quality ? ` · ${e.qualityLabels[job.quality]}` : "";
  return (
    <div>
      <div className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-gray-900 border border-gray-700">
        {job.status === "done" && job.result_url ? (
          <video src={job.result_url} controls muted loop playsInline className="absolute inset-0 w-full h-full object-contain bg-black" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-gray-500 px-4 text-center">
            {job.status === "queued" && "Queued for the Mac"}
            {job.status === "running" && (
              <span className="text-amber-300">Rendering on the Mac…{job.started_at ? ` since ${timeAgo(job.started_at)}` : ""}</span>
            )}
            {job.status === "failed" && <span className="text-red-300 whitespace-pre-wrap break-words">{job.error || "Failed"}</span>}
            {job.status === "canceled" && "Canceled"}
          </div>
        )}
        {text && job.status === "done" && (
          <div className="absolute inset-x-[8%] top-[10%] text-center font-bold text-white text-sm leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,.8)] bg-black/25 rounded-lg px-2 py-1.5 pointer-events-none">
            {text}
          </div>
        )}
        {job.status === "running" && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
            <div className="h-full w-2/3 bg-amber-400 animate-pulse" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-400">
        <span className="truncate">
          {label}
          {q} · {credits(job.estimate_credits)}
        </span>
        <span className="flex gap-2 shrink-0">
          {job.status === "done" && job.result_url && (
            <a href={job.result_url} download className="text-purple-300 hover:text-white inline-flex items-center gap-1">
              <Download size={12} /> Download
            </a>
          )}
          {(job.status === "done" || job.status === "failed") && (
            <button type="button" onClick={onAgain} className="text-purple-300 hover:text-white cursor-pointer">
              Again
            </button>
          )}
          {job.status === "queued" && (
            <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white cursor-pointer inline-flex items-center gap-1">
              <Trash2 size={12} /> Cancel
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function BriefEditor({
  hook,
  onSave,
  onCancel,
}: {
  hook: HookView;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [brief, setBrief] = useState(hook.brief);
  const [creator, setCreator] = useState(hook.creator);
  const [screen, setScreen] = useState(hook.screen_mode);
  const [start, setStart] = useState(Number(hook.trim_start));
  const [end, setEnd] = useState<number>(hook.trim_end ?? Math.min(hook.reference_duration ?? 15, Number(hook.trim_start) + 15));
  const [saving, setSaving] = useState(false);
  return (
    <div>
      <textarea
        id="hook-brief-edit"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {CREATORS.map((c) => (
          <Chip key={c} on={creator === c} onClick={() => setCreator(c)}>
            {c}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {SCREEN_MODES.map((s) => (
          <Chip key={s.id} on={screen === s.id} onClick={() => setScreen(s.id)}>
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
        Keep
        <input id="hook-trim-start-edit" type="number" step={0.5} min={0} value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white" />
        to
        <input id="hook-trim-end-edit" type="number" step={0.5} min={0} value={end} onChange={(e) => setEnd(Number(e.target.value) || 0)} className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white" />
        s
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          primary
          busy={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ brief, creator, screen_mode: screen, trim_start: start, trim_end: end });
            setSaving(false);
          }}
        >
          Save
        </Button>
        <Button ghost onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">After changing the brief, press Rewrite so the prompt matches.</p>
    </div>
  );
}
