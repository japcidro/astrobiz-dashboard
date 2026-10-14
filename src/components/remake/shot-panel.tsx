"use client";

import { AlertTriangle, Check, Download, Images, Loader2, Mic, RefreshCw, Sparkles, Upload, UserCheck, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Quality } from "@/lib/hook-studio/engines";
import { CLIP_ENGINES, STILL_CREDITS, VO_CREDITS_PER_CHAR, clipEstimate, getClipEngine, veoLengthFor } from "@/lib/remake/engines";
import type { LibraryImage, ProjectView, ShotView, Voice } from "@/lib/remake/types";
import { Button, Label, Panel, Pill, api, credits } from "@/components/hook-studio/ui";
import { ClipVideo, ComparePlayer } from "./clip-video";

const field =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Busy({ label }: { label: string }) {
  return (
    <div className="aspect-[9/16] rounded-lg bg-gray-950 border border-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500">
      <Loader2 size={18} className="animate-spin" />
      <p className="text-[11px] text-center px-2">{label}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="aspect-[9/16] rounded-lg bg-gray-950 border border-dashed border-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500 p-3 text-center">{children}</div>;
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
  onCastFrom: (body: { ugc_job_id?: string; path?: string }) => Promise<void>;
}) {
  // Local drafts; the parent remounts this panel per clip (key = shot id).
  const [script, setScript] = useState(shot.script);
  const [direction, setDirection] = useState(shot.voice_direction);
  const [prompt, setPrompt] = useState(shot.clip_prompt ?? "");
  const [picker, setPicker] = useState(false);
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (picker && library === null) api<{ images: LibraryImage[] }>("/api/owner/remake/library").then((r) => setLibrary(r.images)).catch(() => setLibrary([]));
  }, [picker, library]);

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
  const canRender = swap && shot.still_status === "done" && shot.approved && !clipBusy;
  const isCast = project.cast_shot_id === shot.id;
  const ours = shot.mixed_url ?? (swap ? shot.clip_url : shot.ref_url);

  const uploadCast = async (file: File) => {
    setUploading(true);
    try {
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
        method: "POST",
        body: JSON.stringify({ kind: "cast", mime: file.type, project_id: project.id }),
      });
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      await onCastFrom({ path });
      setPicker(false);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Panel className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-white">
          Clip {shot.idx + 1} <span className="text-gray-500 font-normal">· {fmt(Number(shot.start_s))}–{fmt(Number(shot.end_s))} · {shot.seconds}s</span>
        </p>
        {shot.person && <Pill tone="muted">Person {shot.person}</Pill>}
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

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
        <div>
          <Label>Reference vs ours</Label>
          <ComparePlayer refSrc={shot.ref_url} ourSrc={ours} ourLabel={shot.mixed_url ? "Ours + voiceover" : swap ? "Ours" : "Kept"} />
          {!shot.ref_url && <p className="text-[11px] text-gray-500 mt-1">The Mac is cutting the real clip…</p>}
          {ours && (
            <a href={ours} download className="mt-1 text-[11px] text-gray-300 hover:text-white inline-flex items-center gap-1">
              <Download size={11} /> Download ours{shot.clip_credits && swap ? ` · ${credits(shot.clip_credits)}` : ""}
            </a>
          )}
        </div>

        {swap ? (
          <div>
            <Label>Our still · the clip starts from this</Label>
            <div className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-3">
              <div>
                {stillBusy ? (
                  <Busy label={shot.still_status === "running" ? "Nano Banana Pro…" : "Queued on the Mac"} />
                ) : shot.still_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.still_url} alt="" className={`aspect-[9/16] w-full object-cover rounded-lg border bg-black ${shot.approved ? "border-green-600" : "border-gray-800"}`} />
                ) : (
                  <Empty>
                    {project.cast_url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={project.cast_url} alt="" className="w-14 aspect-[9/16] object-cover rounded-md border border-purple-500" />
                        <p className="text-[11px]">{shot.still_status === "failed" ? shot.still_error : "This person goes into the real frame"}</p>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        <p className="text-[11px]">{shot.still_status === "failed" ? shot.still_error : "No still yet"}</p>
                      </>
                    )}
                  </Empty>
                )}
              </div>
              <div className="space-y-2 text-xs">
                {project.cast_url && !shot.still_url && !stillBusy && (
                  <p className="text-gray-400">
                    Person picked. Generate puts them into this clip&apos;s frame{project.brand_kit?.images.length ? " with our product" : ""}.
                  </p>
                )}
                {shot.still_status === "done" && check && (
                  <p className={`inline-flex items-start gap-1 ${checking ? "text-gray-500" : check.ok ? "text-green-400" : "text-red-300"}`}>
                    {checking ? <Loader2 size={11} className="animate-spin mt-0.5" /> : check.ok ? <Check size={11} className="mt-0.5" /> : <AlertTriangle size={11} className="mt-0.5" />}
                    <span>{checking ? "Brand check…" : check.notes}</span>
                  </p>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  <Button primary={!shot.still_url} onClick={() => onAction("still")} busy={busy === "still"} disabled={stillBusy || !shot.frame_url} title={`${STILL_CREDITS} credits`}>
                    {shot.still_url ? <RefreshCw size={13} /> : <Sparkles size={13} />} {shot.still_url ? "Regenerate" : project.cast_url || project.cast_shot_id ? "Generate with this person" : "Generate (new person)"} · {STILL_CREDITS} cr
                  </Button>
                  <Button onClick={() => setPicker((v) => !v)} disabled={stillBusy}>
                    <Images size={13} /> {project.cast_url ? "Change person" : "Use existing image"}
                  </Button>
                </div>
                {picker && (
                  <div className="rounded-lg border border-gray-700 bg-gray-900 p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-gray-400 flex-1">Pick the person to put into every clip: from the UGC Generator library, or upload. The still is then generated from the real frame with them in it.</p>
                      <Button ghost onClick={() => fileRef.current?.click()} busy={uploading}>
                        <Upload size={12} /> Upload
                      </Button>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadCast(e.target.files[0])} />
                    </div>
                    {library === null ? (
                      <Loader2 size={14} className="animate-spin text-gray-500 mx-auto" />
                    ) : library.length === 0 ? (
                      <p className="text-gray-600">The library is empty.</p>
                    ) : (
                      <div className="grid grid-cols-5 gap-1.5 max-h-48 overflow-y-auto">
                        {library.map((img) => (
                          <button
                            key={img.id}
                            type="button"
                            title={img.note}
                            disabled={busy === "cast"}
                            onClick={async () => {
                              await onCastFrom({ ugc_job_id: img.id });
                              setPicker(false);
                            }}
                            className="aspect-[9/16] rounded-md overflow-hidden border border-gray-700 hover:border-purple-500 cursor-pointer disabled:opacity-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {shot.still_status === "done" && (
                  <div className="flex gap-1.5 flex-wrap items-center">
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <select value={shot.clip_engine} onChange={(e) => void onPatch({ clip_engine: e.target.value })} className={field}>
              {CLIP_ENGINES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
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
            {engine.lengths && engine.lengths.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {engine.lengths.map((n) => (
                  <button key={n} type="button" onClick={() => void onPatch({ clip_seconds: n })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${veoLen === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}s
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500 -mt-1">{engine.blurb}</p>

          {speaks && (
            <div className="space-y-2">
              <textarea value={script} onChange={(e) => setScript(e.target.value)} onBlur={() => script !== shot.script && void onPatch({ script })} rows={3} placeholder="What the person says. Veo makes the voice and the lips from this. Keep it to one or two sentences for 8 seconds." className={`${field} resize-none`} />
              <input value={direction} onChange={(e) => setDirection(e.target.value)} onBlur={() => direction !== shot.voice_direction && void onPatch({ voice_direction: direction })} placeholder="Voice direction, e.g. warm, casual, slight smile" className={field} />
            </div>
          )}
          {swap && engine.mode === "speak" && shot.kind === "broll" && <p className="text-[11px] text-gray-500">B-roll: Veo animates the still with natural ambience and no speech. Add a voiceover below.</p>}
          {engine.mode === "prompt" && (
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => prompt !== (shot.clip_prompt ?? "") && void onPatch({ clip_prompt: prompt })} rows={2} placeholder="Optional motion prompt. Empty = natural small movement." className={`${field} resize-none`} />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button primary onClick={() => onAction("clip")} busy={busy === "clip"} disabled={!canRender || (speaks && script !== shot.script)}>
              {clipBusy ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />} {shot.clip_url ? "Render again" : "Render clip"}
            </Button>
            <span className="text-xs text-gray-400">
              ≈ {credits(estimate)} · {engine.lengths ? `${veoLen}s` : `${Math.ceil(shot.seconds)}s, follows the real clip`}
            </span>
            {shot.clip_status === "failed" && <span className="text-xs text-red-300">{shot.clip_error}</span>}
            {!shot.approved && shot.still_status === "done" && <span className="text-xs text-amber-300">Approve the still first</span>}
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
            {mixBusy && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Mixing onto the clip…</span>}
            {shot.mixed_status === "done" && shot.mixed_url && <span className="text-xs text-green-400 inline-flex items-center gap-1"><Check size={11} /> Mixed</span>}
            {shot.audio_status === "failed" && <span className="text-xs text-red-300">{shot.audio_error}</span>}
          </div>
          {shot.audio_url && (
            <div className="flex items-center gap-2">
              <audio key={shot.audio_url} src={shot.audio_url} controls className="h-8 flex-1" />
              {shot.audio_seconds && <Pill tone={shot.audio_seconds > shot.seconds + 0.5 ? "warn" : "muted"}>{shot.audio_seconds}s{shot.audio_seconds > shot.seconds + 0.5 ? " · longer than the clip" : ""}</Pill>}
              <a href={shot.audio_url} download className="text-[11px] text-gray-300 hover:text-white inline-flex items-center gap-1"><Download size={11} /> MP3</a>
            </div>
          )}
          {voices.length === 0 && <p className="text-[11px] text-amber-300">No voices yet: the Mac worker lists them when it is online.</p>}
        </div>
      )}

      {shot.ref_url && !swap && shot.selected && (
        <div className="hidden">
          <ClipVideo src={shot.ref_url} autoplay={false} />
        </div>
      )}
    </Panel>
  );
}
