"use client";

import { AlertTriangle, Check, Download, Loader2, Mic, RefreshCw, Sparkles, UserCheck, Video } from "lucide-react";
import { useState } from "react";
import type { Quality } from "@/lib/hook-studio/engines";
import { CLIP_ENGINES, STILL_CREDITS, TTS_CREDITS_PER_CHAR, clipEstimate, getClipEngine } from "@/lib/remake/engines";
import type { ProjectView, ShotView, Voice } from "@/lib/remake/types";
import { Button, Label, Panel, Pill, credits } from "@/components/hook-studio/ui";

const field =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Busy({ label }: { label: string }) {
  return (
    <div className="aspect-[9/16] rounded-lg bg-gray-950 border border-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500">
      <Loader2 size={18} className="animate-spin" />
      <p className="text-[11px]">{label}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="aspect-[9/16] rounded-lg bg-gray-950 border border-dashed border-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500 p-3 text-center">{children}</div>;
}

/** One shot across its three stages: real frame → our still → clip. */
export function ShotPanel({
  project,
  shot,
  voices,
  busy,
  onPatch,
  onAction,
  onProjectPatch,
}: {
  project: ProjectView;
  shot: ShotView;
  voices: Voice[];
  busy: string | null;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onAction: (action: "still" | "voice" | "clip") => Promise<void>;
  onProjectPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  // Local drafts; the parent remounts this panel per shot (key = shot id).
  const [script, setScript] = useState(shot.script);
  const [prompt, setPrompt] = useState(shot.clip_prompt ?? "");

  const engine = getClipEngine(shot.clip_engine) ?? CLIP_ENGINES[0];
  const speak = engine.mode === "speak";
  const seconds = speak ? Number(shot.audio_seconds ?? shot.seconds) : shot.seconds;
  const estimate = clipEstimate(engine.id, shot.clip_quality, seconds);
  const stillBusy = shot.still_status === "queued" || shot.still_status === "running";
  const audioBusy = shot.audio_status === "queued" || shot.audio_status === "running";
  const clipBusy = shot.clip_status === "queued" || shot.clip_status === "running";
  const check = shot.brand_check;
  const checking = check?.notes === "Checking…";
  const canRender = shot.still_status === "done" && shot.approved && (!speak || shot.audio_status === "done") && !clipBusy;
  const isCast = project.cast_shot_id === shot.id;

  return (
    <Panel className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-white">
          Shot {shot.idx + 1} <span className="text-gray-500 font-normal">· {fmt(Number(shot.start_s))}–{fmt(Number(shot.end_s))} · {shot.seconds}s</span>
        </p>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-gray-900 p-0.5">
          {(["talking_head", "broll"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => k !== shot.kind && void onPatch({ kind: k })}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${shot.kind === k ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {k === "talking_head" ? "Talking head" : "B-roll"}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={shot.selected} onChange={(e) => void onPatch({ selected: e.target.checked })} className="accent-purple-500" />
          Remake this shot
        </label>
      </div>
      {shot.brand_heavy && (
        <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> Mostly competitor packaging or a screen. Swapping the person won&apos;t make this ours; consider keeping the original or redoing it in CapCut.
        </p>
      )}
      {shot.description && <p className="text-xs text-gray-400 -mt-2">{shot.description}</p>}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Real frame</Label>
          {shot.frame_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.frame_url} alt="" className="aspect-[9/16] w-full object-cover rounded-lg border border-gray-800 bg-black" />
          ) : (
            <Empty>
              <p className="text-[11px]">No frame</p>
            </Empty>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5">From the reference. Nothing is generated from scratch.</p>
        </div>

        <div>
          <Label>Same shot, new person, our product</Label>
          {stillBusy ? (
            <Busy label={shot.still_status === "running" ? "Nano Banana Pro…" : "Queued on the Mac"} />
          ) : shot.still_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.still_url} alt="" className={`aspect-[9/16] w-full object-cover rounded-lg border bg-black ${shot.approved ? "border-green-600" : "border-gray-800"}`} />
          ) : (
            <Empty>
              <Sparkles size={16} />
              <p className="text-[11px]">{shot.still_status === "failed" ? shot.still_error : `${STILL_CREDITS} credits`}</p>
            </Empty>
          )}
          <div className="mt-1.5 space-y-1.5">
            {shot.still_status === "done" && check && (
              <p className={`text-[11px] inline-flex items-start gap-1 ${checking ? "text-gray-500" : check.ok ? "text-green-400" : "text-red-300"}`}>
                {checking ? <Loader2 size={11} className="animate-spin mt-0.5" /> : check.ok ? <Check size={11} className="mt-0.5" /> : <AlertTriangle size={11} className="mt-0.5" />}
                <span>{checking ? "Brand check…" : check.notes}</span>
              </p>
            )}
            <div className="flex gap-1.5 flex-wrap">
              <Button onClick={() => onAction("still")} busy={busy === "still"} disabled={stillBusy || !shot.frame_url} title={shot.still_url ? "Make a new still" : "Generate the still"}>
                {shot.still_url ? <RefreshCw size={13} /> : <Sparkles size={13} />} {shot.still_url ? "Regenerate" : "Generate still"}
              </Button>
              {shot.still_status === "done" && (
                <Button primary={!shot.approved} onClick={() => onPatch({ approved: !shot.approved })} busy={busy === "approve"}>
                  <Check size={13} /> {shot.approved ? "Approved" : "Approve"}
                </Button>
              )}
            </div>
            {shot.still_status === "done" && shot.approved && (
              <button
                type="button"
                disabled={isCast}
                onClick={() => void onProjectPatch({ cast_shot_id: shot.id })}
                className="text-[11px] inline-flex items-center gap-1 text-purple-300 hover:text-white disabled:text-green-400 cursor-pointer disabled:cursor-default"
              >
                <UserCheck size={11} /> {isCast ? "This is the cast" : "Use this person as the cast"}
              </button>
            )}
          </div>
        </div>

        <div>
          <Label>Clip</Label>
          {clipBusy ? (
            <Busy label={shot.clip_status === "running" ? `${engine.name}…` : "Queued on the Mac"} />
          ) : shot.clip_url ? (
            <video key={shot.clip_url} src={shot.clip_url} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg border border-gray-800 bg-black" />
          ) : (
            <Empty>
              <Video size={16} />
              <p className="text-[11px]">{shot.clip_status === "failed" ? shot.clip_error : shot.approved ? "Ready to render" : "Approve the still first"}</p>
            </Empty>
          )}
          {shot.clip_url && (
            <a href={shot.clip_url} download className="mt-1.5 text-[11px] text-gray-300 hover:text-white inline-flex items-center gap-1">
              <Download size={11} /> Download{shot.clip_credits ? ` · ${credits(shot.clip_credits)}` : ""}
            </a>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <select value={shot.clip_engine} onChange={(e) => void onPatch({ clip_engine: e.target.value })} className={field}>
            {CLIP_ENGINES.filter((e) => (shot.kind === "talking_head" ? true : e.mode !== "speak")).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.perSecond[shot.clip_quality]} cr/s
              </option>
            ))}
          </select>
          {engine.qualityLabels && (
            <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
              {(["standard", "high"] as Quality[]).map((q) => (
                <button key={q} type="button" onClick={() => q !== shot.clip_quality && void onPatch({ clip_quality: q })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${shot.clip_quality === q ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                  {engine.qualityLabels![q]}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-500 -mt-1">{engine.blurb}</p>

        {speak && (
          <div className="space-y-2">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              onBlur={() => script !== shot.script && void onPatch({ script })}
              rows={3}
              placeholder="What the person says in this shot. Keep it under 15 seconds of speech."
              className={`${field} resize-none`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={shot.voice_id ?? ""}
                onChange={(e) => {
                  const v = voices.find((x) => x.id === e.target.value);
                  void onPatch(v ? { voice_id: v.id, voice_type: v.type, voice_name: v.name } : { voice_id: null });
                }}
                className={`${field} sm:w-56`}
              >
                <option value="">Pick a voice…</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.type === "element" ? " (cloned)" : ""}
                  </option>
                ))}
              </select>
              <Button onClick={() => onAction("voice")} busy={busy === "voice"} disabled={audioBusy || !script.trim() || !shot.voice_id || script !== shot.script}>
                <Mic size={13} /> {shot.audio_url ? "Redo voice" : "Generate voice"}
                <span className="text-[10px] text-gray-300 font-normal">≈ {credits(Math.max(0.15, script.length * TTS_CREDITS_PER_CHAR))}</span>
              </Button>
              {audioBusy && <Loader2 size={14} className="animate-spin text-gray-400" />}
              {shot.audio_status === "failed" && <span className="text-xs text-red-300">{shot.audio_error}</span>}
            </div>
            {shot.audio_url && (
              <div className="flex items-center gap-2">
                <audio key={shot.audio_url} src={shot.audio_url} controls className="h-8 flex-1" />
                {shot.audio_seconds && <Pill tone={shot.audio_seconds > 15 ? "warn" : "muted"}>{shot.audio_seconds}s</Pill>}
              </div>
            )}
            {voices.length === 0 && <p className="text-[11px] text-amber-300">No voices yet: the Mac worker lists them when it is online.</p>}
          </div>
        )}

        {engine.mode === "prompt" && (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => prompt !== (shot.clip_prompt ?? "") && void onPatch({ clip_prompt: prompt })}
            rows={2}
            placeholder="Optional motion prompt. Empty = keep the still, natural small movement."
            className={`${field} resize-none`}
          />
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button primary onClick={() => onAction("clip")} busy={busy === "clip"} disabled={!canRender}>
            <Video size={13} /> {shot.clip_url ? "Render again" : "Render clip"}
          </Button>
          <span className="text-xs text-gray-400">
            ≈ {credits(estimate)} · {Math.ceil(seconds)}s{engine.mode === "motion" ? " · follows the real shot" : speak ? " · follows the voice" : ""}
          </span>
        </div>
      </div>
    </Panel>
  );
}
