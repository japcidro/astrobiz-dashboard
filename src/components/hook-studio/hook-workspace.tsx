"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SKILLS, enginesForSkill, getEngine, clipCredits, type EngineId, type Quality } from "@/lib/hook-studio/engines";
import type { HookView, JobView, WorkerStatus } from "@/lib/hook-studio/types";
import { Panel, Label, Button, Pill, credits, timeAgo, api } from "./ui";

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 20000;
const DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15];

export function HookWorkspace({ id, worker, onBack }: { id: string; worker: WorkerStatus | null; onBack: () => void }) {
  const [hook, setHook] = useState<HookView | null>(null);
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<EngineId | null>(null);
  const [quality, setQuality] = useState<Quality>("standard");
  const [duration, setDuration] = useState(5);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  const promptDirty = useRef(false);
  const settingsSeeded = useRef(false);

  const load = useCallback(
    () =>
      api<HookView>(`/api/owner/hook-studio/hooks/${id}`).then((h) => {
        setHook(h);
        if (!promptDirty.current) setPrompt(h.edit_prompt ?? "");
        if (!settingsSeeded.current) {
          settingsSeeded.current = true;
          setEngine(h.engine);
          setQuality(h.quality);
          setDuration(h.duration);
        }
        return h;
      }),
    [id]
  );

  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);

  const pending = useMemo(() => (hook?.jobs ?? []).some((j) => j.status === "queued" || j.status === "running"), [hook]);
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
      if (duration !== hook?.duration) await patch({ duration });
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

  const generate = async () => {
    if (!engine) return;
    try {
      setBusy("generate");
      if (promptDirty.current) await patch({ edit_prompt: prompt });
      promptDirty.current = false;
      const h = await api<HookView>(`/api/owner/hook-studio/hooks/${id}/remakes`, {
        method: "POST",
        body: JSON.stringify({ engine, quality, duration, count }),
      });
      setHook(h);
      toast.success(worker?.online ? `${count} clip${count > 1 ? "s" : ""} queued` : "Queued. It runs when the Mac is online.");
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
        body: JSON.stringify({ engine: j.engine_id, quality: j.quality ?? "standard", duration: j.duration ?? duration, count: 1 }),
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

  if (!hook) return <p className="text-sm text-gray-500">Loading…</p>;

  const skillInfo = SKILLS.find((s) => s.id === hook.skill)!;
  const engines = enginesForSkill(hook.skill);
  const eng = getEngine(engine ?? "") ?? engines[0];
  const refSeconds = hook.trim_end !== null ? Math.max(1, Math.round(Number(hook.trim_end) - Number(hook.trim_start))) : Math.min(15, Math.round(hook.reference_duration ?? 5));
  const effectiveSeconds = eng.followsReference ? refSeconds : duration;
  const perClip = clipCredits(eng.id, quality, effectiveSeconds);
  const total = Math.round(perClip * count * 100) / 100;
  const clips = hook.jobs.slice().reverse();
  const canGenerate = !!prompt.trim() && !!hook.ugc?.result_url && (!skillInfo.needsReference || !!hook.reference_path);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button ghost onClick={onBack}>
            <ArrowLeft size={16} /> Library
          </Button>
          <div className="min-w-0">
            <p className="text-white font-semibold truncate">{hook.title || "Untitled hook"}</p>
            <p className="text-xs text-gray-500">
              {skillInfo.name} · {timeAgo(hook.created_at)}
            </p>
          </div>
        </div>
        {worker &&
          (worker.online ? (
            <Pill tone="ok">
              Mac worker online{worker.credits !== null ? ` · ${credits(worker.credits)}` : ""}
              {worker.running > 0 ? ` · ${worker.running} rendering` : ""}
              {worker.queued > 0 ? ` · ${worker.queued} queued` : ""}
            </Pill>
          ) : (
            <Pill tone="warn">Mac worker offline{worker.last_seen ? ` · last seen ${timeAgo(worker.last_seen)}` : ""}</Pill>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        <Panel>
          <div className={`grid ${hook.reference_url ? "grid-cols-[120px_120px_1fr]" : "grid-cols-[120px_1fr]"} gap-4 items-start`}>
            <div>
              <Label>UGC image</Label>
              {hook.ugc?.result_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL
                <img src={hook.ugc.result_url} alt="ugc" className="w-full aspect-[9/16] object-cover rounded-xl border border-gray-700 bg-black" />
              ) : (
                <div className="w-full aspect-[9/16] rounded-xl bg-gray-900 border border-gray-700 grid place-items-center text-[11px] text-gray-500 text-center px-2">Image was deleted</div>
              )}
            </div>
            {hook.reference_url && (
              <div>
                <Label>Reference</Label>
                <video src={hook.reference_url} controls muted playsInline className="w-full aspect-[9/16] rounded-xl bg-black object-contain border border-gray-700" />
                <p className="text-[11px] text-gray-500 mt-1">
                  {Number(hook.trim_start)}s to {hook.trim_end ?? hook.reference_duration ?? "end"}s
                </p>
              </div>
            )}
            <div className="text-sm">
              <Label>Brief</Label>
              {!editingBrief ? (
                <>
                  <p className="text-gray-300 whitespace-pre-wrap">{hook.brief || <span className="text-gray-600">No brief. Claude works from the image.</span>}</p>
                  <div className="mt-3">
                    <Button ghost onClick={() => setEditingBrief(true)}>Edit brief</Button>
                  </div>
                </>
              ) : (
                <BriefEditor
                  brief={hook.brief}
                  onSave={async (b) => {
                    await patch({ brief: b }).catch((e) => toast.error(e.message));
                    setEditingBrief(false);
                  }}
                  onCancel={() => setEditingBrief(false)}
                />
              )}
            </div>
          </div>
        </Panel>

        <div className="rounded-xl border border-purple-500/40 bg-gradient-to-b from-purple-500/10 to-purple-500/[0.03] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-purple-300 font-bold flex items-center gap-1.5">
              <Sparkles size={12} /> Prompt {hook.skill === "arcads" ? "· shot by shot" : "· motion transfer"}
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
            rows={hook.skill === "arcads" ? 12 : 6}
            placeholder={busy === "rewrite" ? "Claude is writing…" : "No prompt yet. Press Rewrite."}
            className="mt-2 w-full bg-black/25 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white leading-relaxed placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <Panel>
        <Label>Engine</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {engines.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEngine(e.id);
                if (!e.qualityLabels) setQuality("standard");
                setDuration((d) => Math.min(e.maxSeconds, Math.max(e.minSeconds, d)));
              }}
              className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${eng.id === e.id ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"}`}
            >
              <p className="text-sm font-semibold text-white">{e.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{e.blurb}</p>
              <p className="text-xs font-mono text-gray-300 mt-1">
                {e.qualityLabels ? `${e.perSecond.standard} · ${e.perSecond.high}` : e.perSecond.standard} cr / second
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-4 flex-wrap">
          {eng.qualityLabels && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Quality</span>
              <Seg value={quality} options={[["standard", eng.qualityLabels.standard], ["high", eng.qualityLabels.high]]} onChange={(v) => setQuality(v as Quality)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Seconds</span>
            {eng.followsReference ? (
              <Pill tone="muted">follows the reference · {refSeconds}s</Pill>
            ) : (
              <Seg
                value={String(duration)}
                options={DURATIONS.filter((d) => d >= eng.minSeconds && d <= eng.maxSeconds).map((d) => [String(d), `${d}`])}
                onChange={(v) => setDuration(Number(v))}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Clips</span>
            <Seg value={String(count)} options={[["1", "1"], ["2", "2"], ["3", "3"]]} onChange={(v) => setCount(Number(v))} />
          </div>
          <Pill tone="muted">Silent · 9:16</Pill>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500 max-w-lg">
            {!hook.ugc?.result_url
              ? "This hook's UGC image was deleted. Make a new hook."
              : !prompt.trim()
                ? "Write or rewrite the prompt first."
                : worker && !worker.online
                  ? "The Mac worker is offline. Clips queue now and run when it's back."
                  : `Estimated ${credits(perClip)} per clip. The Mac records the exact number when it runs.`}
          </p>
          <Button primary onClick={generate} busy={busy === "generate"} disabled={!canGenerate}>
            Generate ×{count} · {credits(total)}
          </Button>
        </div>
      </Panel>

      {clips.length > 0 && (
        <Panel>
          <Label>Clips</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {clips.map((j) => (
              <ClipCard key={j.id} job={j} onAgain={() => again(j)} onCancel={() => cancel(j)} />
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
        <button key={v} type="button" onClick={() => onChange(v)} className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${value === v ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ClipCard({ job, onAgain, onCancel }: { job: JobView; onAgain: () => void; onCancel: () => void }) {
  const e = getEngine(job.engine_id);
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
            {job.status === "running" && <span className="text-amber-300">Rendering on the Mac…{job.started_at ? ` since ${timeAgo(job.started_at)}` : ""}</span>}
            {job.status === "failed" && <span className="text-red-300 whitespace-pre-wrap break-words">{job.error || "Failed"}</span>}
            {job.status === "canceled" && "Canceled"}
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
          {q}
          {job.duration ? ` · ${job.duration}s` : ""} · {credits(job.estimate_credits)}
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

function BriefEditor({ brief, onSave, onCancel }: { brief: string; onSave: (b: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(brief);
  const [saving, setSaving] = useState(false);
  return (
    <div>
      <textarea id="hook-brief-edit" value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
      <div className="flex gap-2 mt-2">
        <Button
          primary
          busy={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(value);
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
