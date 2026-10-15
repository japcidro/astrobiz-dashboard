"use client";

import { AlertTriangle, Check, Download, Images, Info, Loader2, Maximize2, Mic, RefreshCw, Sparkles, UserCheck, Video } from "lucide-react";
import { useState } from "react";
import type { Quality } from "@/lib/hook-studio/engines";
import { CLIP_ENGINES, STILL_CREDITS, VO_CREDITS_PER_CHAR, clipEstimate, getClipEngine, veoLengthFor } from "@/lib/remake/engines";
import { PRODUCT_FORMS, type CastSource, type ProjectView, type ShotView, type Voice } from "@/lib/remake/types";
import { Button, Label, Panel, Pill, credits } from "@/components/hook-studio/ui";
import { CastPicker } from "./cast-picker";
import { ClipVideo, ComparePlayer, Lightbox } from "./clip-video";

const field =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const NOT_CHECKED = /^Not checked/;

function Frame({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <div className={`aspect-[9/16] rounded-lg bg-gray-950 border ${dashed ? "border-dashed" : ""} border-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500 p-3 text-center`}>
      {children}
    </div>
  );
}

/** One clip: keep the real one, or redo it from our still and animate. */
export function ShotPanel({
  project,
  shot,
  voices,
  busy,
  onPatch,
  onAction,
  onProjectPatch,
  onCastFrom,
}: {
  project: ProjectView;
  shot: ShotView;
  voices: Voice[];
  busy: string | null;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onAction: (action: string, body?: Record<string, unknown>) => Promise<void>;
  onProjectPatch: (body: Record<string, unknown>) => Promise<void>;
  /** Pick the person for every clip from an existing image. */
  onCastFrom: (body: CastSource) => Promise<void>;
}) {
  // Local drafts; the parent remounts this panel per clip (key = shot id).
  const [script, setScript] = useState(shot.script);
  const [direction, setDirection] = useState(shot.voice_direction);
  const [prompt, setPrompt] = useState(shot.clip_prompt ?? "");
  const [picker, setPicker] = useState(false);
  const [zoom, setZoom] = useState<{ video?: string; image?: string } | null>(null);

  const engine = getClipEngine(shot.clip_engine) ?? CLIP_ENGINES[0];
  const swap = shot.mode === "swap";
  const speaks = swap && engine.mode === "speak" && shot.kind === "talking_head";
  const showVoiceover = !speaks;
  const veoLen = engine.id === "veo3" ? 8 : engine.lengths ? (engine.lengths.includes(Number(shot.clip_seconds)) ? Number(shot.clip_seconds) : veoLengthFor(shot.seconds)) : shot.seconds;
  const estimate = clipEstimate(engine.id, shot.clip_quality, veoLen);
  const stillBusy = shot.still_status === "queued" || shot.still_status === "running";
  const audioBusy = shot.audio_status === "queued" || shot.audio_status === "running";
  const clipBusy = shot.clip_status === "queued" || shot.clip_status === "running";
  const mixBusy = shot.mixed_status === "queued" || shot.mixed_status === "running";
  const check = shot.brand_check;
  const checking = check?.notes === "Checking…";
  const unchecked = !!check && NOT_CHECKED.test(check.notes);
  const canRender = swap && shot.still_status === "done" && shot.approved && !clipBusy;
  const isCast = project.cast_shot_id === shot.id;
  const hasPerson = !!project.cast_url || !!project.cast_shot_id;
  /** What there is to compare against the reference: our rendered clip, or the kept clip once a voiceover is mixed in. */
  const result = swap ? (shot.mixed_url ?? shot.clip_url) : shot.mixed_url;

  return (
    <Panel className="space-y-4">
      {picker && <CastPicker projectId={project.id} current={project.cast_url} onPick={onCastFrom} onClose={() => setPicker(false)} />}
      {zoom && <Lightbox video={zoom.video} image={zoom.image} onClose={() => setZoom(null)} />}

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-white">
          Clip {shot.idx + 1} <span className="text-gray-500 font-normal">· {fmt(Number(shot.start_s))}–{fmt(Number(shot.end_s))} · {shot.seconds}s</span>
        </p>
        {shot.person && <Pill tone="muted">Person {shot.person}</Pill>}
        <label className="inline-flex items-center gap-1 text-[11px] text-gray-400" title="What the person holds in this frame; the still swap replaces it with our matching product">
          holds
          <select value={shot.holds ?? "none"} onChange={(e) => void onPatch({ holds: e.target.value })} className="bg-gray-900 border border-gray-700 rounded-md px-1 py-0.5 text-[11px] text-gray-300 focus:outline-none">
            <option value="none">nothing</option>
            {PRODUCT_FORMS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-gray-900 p-0.5">
          {(["talking_head", "broll"] as const).map((k) => (
            <button key={k} type="button" onClick={() => k !== shot.kind && void onPatch({ kind: k })} className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${shot.kind === k ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
              {k === "talking_head" ? "Talking head" : "B-roll"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-gray-900 p-0.5">
          {(["keep", "swap"] as const).map((m) => (
            <button key={m} type="button" onClick={() => m !== shot.mode && void onPatch({ mode: m })} className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${shot.mode === m ? (m === "swap" ? "bg-purple-600 text-white" : "bg-gray-700 text-white") : "text-gray-400 hover:text-white"}`}>
              {m === "keep" ? "Keep original" : "Swap person"}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={shot.selected} onChange={(e) => void onPatch({ selected: e.target.checked })} className="accent-purple-500" />
          Export
        </label>
      </div>
      {shot.brand_heavy && (
        <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> Mostly competitor packaging or a screen. Swapping the person won&apos;t make this ours; it is set to keep the original.
        </p>
      )}
      {shot.description && shot.description !== "—" && <p className="text-xs text-gray-400 -mt-2">{shot.description}</p>}

      {/* Reference + our still (or the kept note) */}
      <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-4">
        <div>
          <Label>Reference</Label>
          {shot.ref_url ? (
            <div className="relative group/ref">
              <ClipVideo src={shot.ref_url} className="aspect-[9/16]" />
              <button
                type="button"
                onClick={() => setZoom({ video: shot.ref_url! })}
                aria-label="Open the reference clip full size"
                title="Open full size with sound"
                className="absolute top-1.5 right-1.5 text-white/90 bg-black/50 hover:bg-black/80 rounded-full p-1 opacity-70 group-hover/ref:opacity-100 cursor-pointer"
              >
                <Maximize2 size={11} />
              </button>
            </div>
          ) : (
            <Frame dashed>
              <Loader2 size={14} className="animate-spin" />
              <p className="text-[11px]">Cutting the real clip…</p>
            </Frame>
          )}
        </div>

        {swap ? (
          <div>
            <Label>Our still · the clip starts from this</Label>
            <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-3">
              <div>
                {stillBusy ? (
                  <Frame>
                    <Loader2 size={18} className="animate-spin" />
                    <p className="text-[11px]">{shot.still_status === "running" ? "Nano Banana Pro…" : "Queued on the Mac"}</p>
                  </Frame>
                ) : shot.still_preview_url ? (
                  <button type="button" onClick={() => setZoom({ image: shot.still_url ?? shot.still_preview_url! })} title="Open the still full size" className="relative group/still block w-full cursor-zoom-in">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.still_preview_url} alt="" className={`aspect-[9/16] w-full object-cover rounded-lg border bg-black ${shot.approved ? "border-green-600" : "border-gray-800"}`} />
                    <span className="absolute top-1.5 right-1.5 text-white/90 bg-black/50 rounded-full p-1 opacity-70 group-hover/still:opacity-100">
                      <Maximize2 size={11} />
                    </span>
                  </button>
                ) : project.cast_url ? (
                  <Frame dashed>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={project.cast_url} alt="" className="w-16 aspect-[9/16] object-cover rounded-md border border-purple-500" />
                    <p className="text-[11px]">This person goes into the real frame</p>
                  </Frame>
                ) : (
                  <Frame dashed>
                    <Sparkles size={16} />
                    <p className="text-[11px]">{shot.still_status === "failed" ? shot.still_error : "No still yet"}</p>
                  </Frame>
                )}
              </div>

              <div className="space-y-2.5 text-xs">
                {!shot.still_preview_url && !stillBusy && (
                  <p className="text-gray-400">
                    {hasPerson ? "Generate puts the picked person into this clip's frame" : "Generate makes a new US person in this clip's frame"}
                    {project.brand_kit?.images.length ? ", holding our product." : "."}
                  </p>
                )}
                {shot.still_status === "failed" && shot.still_preview_url && <p className="text-red-300">{shot.still_error}</p>}

                <div className="flex gap-1.5 flex-wrap">
                  <Button primary={!shot.still_preview_url} onClick={() => onAction("still")} busy={busy === "still"} disabled={stillBusy || !shot.frame_url} title={`${STILL_CREDITS} credits`}>
                    {shot.still_preview_url ? <RefreshCw size={13} /> : <Sparkles size={13} />} {shot.still_preview_url ? "Regenerate" : "Generate still"} · {STILL_CREDITS} cr
                  </Button>
                  <Button onClick={() => setPicker(true)} disabled={stillBusy}>
                    <Images size={13} /> {project.cast_url ? "Change person" : "Use existing image"}
                  </Button>
                </div>

                {shot.still_status === "done" && check && (
                  <p className={`inline-flex items-start gap-1.5 ${checking || unchecked ? "text-gray-500" : check.ok ? "text-green-400" : "text-red-300"}`}>
                    {checking ? <Loader2 size={11} className="animate-spin mt-0.5" /> : unchecked ? <Info size={11} className="mt-0.5" /> : check.ok ? <Check size={11} className="mt-0.5" /> : <AlertTriangle size={11} className="mt-0.5" />}
                    <span>
                      {checking ? "Brand check…" : check.notes}
                      {!checking && (
                        <button type="button" onClick={() => void onAction("recheck")} className="ml-2 text-purple-300 hover:text-white cursor-pointer">
                          Check again
                        </button>
                      )}
                    </span>
                  </p>
                )}

                {shot.still_status === "done" && (
                  <div className="flex gap-2 flex-wrap items-center">
                    <Button primary={!shot.approved} onClick={() => onPatch({ approved: !shot.approved })} busy={busy === "approve"}>
                      <Check size={13} /> {shot.approved ? "Approved" : "Approve still"}
                    </Button>
                    {shot.approved && (
                      <button type="button" disabled={isCast} onClick={() => void onProjectPatch({ cast_shot_id: shot.id })} className="inline-flex items-center gap-1 text-purple-300 hover:text-white disabled:text-green-400 cursor-pointer disabled:cursor-default">
                        <UserCheck size={11} /> {isCast ? "This is the cast" : "Use this person as the cast"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Label>Kept as it is</Label>
            <p className="text-xs text-gray-400">The real clip goes out unchanged{shot.audio_path ? ", with your voiceover mixed in" : ""}. Switch to &ldquo;Swap person&rdquo; to redo it from our still.</p>
            {!shot.selected && <p className="text-xs text-gray-600 mt-1">Not exported.</p>}
          </div>
        )}
      </div>

      {swap && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {CLIP_ENGINES.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => e.id !== shot.clip_engine && void onPatch({ clip_engine: e.id })}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  shot.clip_engine === e.id ? "border-purple-500 bg-purple-500/15 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                }`}
              >
                {e.name}
                <span className="font-normal text-gray-500"> · {e.mode === "speak" ? "speaks the script" : e.mode === "motion" ? "copies the real motion" : "from a prompt"}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {engine.qualityLabels && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {(["standard", "high"] as Quality[]).map((q) => (
                  <button key={q} type="button" onClick={() => q !== shot.clip_quality && void onPatch({ clip_quality: q })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${shot.clip_quality === q ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {engine.qualityLabels![q]}
                  </button>
                ))}
              </div>
            )}
            {engine.lengths && engine.lengths.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {engine.lengths.map((n) => (
                  <button key={n} type="button" onClick={() => void onPatch({ clip_seconds: n })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${veoLen === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}s
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-500">{engine.blurb}</p>
          </div>

          {speaks && (
            <div className="space-y-2">
              <textarea value={script} onChange={(e) => setScript(e.target.value)} onBlur={() => script !== shot.script && void onPatch({ script })} rows={3} placeholder="What the person says. Veo makes the voice and the lips from this. One or two sentences for 8 seconds." className={`${field} resize-none`} />
              <input value={direction} onChange={(e) => setDirection(e.target.value)} onBlur={() => direction !== shot.voice_direction && void onPatch({ voice_direction: direction })} placeholder="Voice direction, e.g. warm, casual, slight smile" className={field} />
            </div>
          )}
          {engine.mode === "speak" && shot.kind === "broll" && <p className="text-[11px] text-gray-500">B-roll: Veo animates the still with natural ambience and no speech. Add a voiceover below.</p>}
          {engine.mode === "prompt" && (
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => prompt !== (shot.clip_prompt ?? "") && void onPatch({ clip_prompt: prompt })} rows={2} placeholder="Optional motion prompt. Empty = natural small movement." className={`${field} resize-none`} />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button primary onClick={() => onAction("clip")} busy={busy === "clip"} disabled={!canRender || (speaks && script !== shot.script)}>
              {clipBusy ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />} {clipBusy ? (shot.clip_status === "running" ? `${engine.name} rendering…` : "Queued on the Mac") : shot.clip_url ? "Render again" : "Render clip"}
            </Button>
            <span className="text-xs text-gray-400">
              ≈ {credits(estimate)} · {engine.lengths ? `${veoLen}s` : `${Math.ceil(shot.seconds)}s, follows the real clip`}
            </span>
            {shot.clip_status === "failed" && <span className="text-xs text-red-300">{shot.clip_error}</span>}
            {!shot.approved && shot.still_status === "done" && <span className="text-xs text-amber-300">Approve the still first</span>}
          </div>
        </div>
      )}

      {result && (
        <div>
          <Label>Result · reference vs ours</Label>
          <div className="max-w-sm">
            <ComparePlayer refSrc={shot.ref_url} ourSrc={result} ourLabel={shot.mixed_url ? "Ours + voiceover" : "Ours"} />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <a href={result} download className="text-gray-300 hover:text-white inline-flex items-center gap-1" title="Free: saves the finished clip">
              <Download size={11} /> Download
            </a>
            {shot.clip_credits && swap ? <span className="text-gray-600">This render cost {credits(shot.clip_credits)}</span> : null}
          </div>
        </div>
      )}

      {showVoiceover && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-300 inline-flex items-center gap-1.5">
            <Mic size={12} /> Voiceover · ElevenLabs v4 <span className="text-gray-500 font-normal">· mixed onto the clip, MP3 saved too</span>
          </p>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} onBlur={() => script !== shot.script && void onPatch({ script })} rows={2} placeholder="The line spoken over this clip. Leave empty for no voiceover." className={`${field} resize-none`} />
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
              <Mic size={13} /> {shot.audio_url ? "Redo voiceover" : "Generate voiceover"}
              <span className="text-[10px] text-gray-300 font-normal">≈ {credits(Math.max(0.2, script.length * VO_CREDITS_PER_CHAR))}</span>
            </Button>
            {audioBusy && <Loader2 size={14} className="animate-spin text-gray-400" />}
            {mixBusy && (
              <span className="text-xs text-gray-400 inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Mixing onto the clip…
              </span>
            )}
            {shot.mixed_status === "done" && shot.mixed_url && (
              <span className="text-xs text-green-400 inline-flex items-center gap-1">
                <Check size={11} /> Mixed
              </span>
            )}
            {shot.audio_status === "failed" && <span className="text-xs text-red-300">{shot.audio_error}</span>}
          </div>
          {shot.audio_url && (
            <div className="flex items-center gap-2">
              <audio key={shot.audio_url} src={shot.audio_url} controls className="h-8 flex-1" />
              {shot.audio_seconds && <Pill tone={shot.audio_seconds > shot.seconds + 0.5 ? "warn" : "muted"}>{shot.audio_seconds}s{shot.audio_seconds > shot.seconds + 0.5 ? " · longer than the clip" : ""}</Pill>}
              <a href={shot.audio_url} download className="text-[11px] text-gray-300 hover:text-white inline-flex items-center gap-1">
                <Download size={11} /> MP3
              </a>
            </div>
          )}
          {voices.length === 0 && <p className="text-[11px] text-amber-300">No voices yet: the Mac worker lists them when it is online.</p>}
        </div>
      )}
    </Panel>
  );
}
