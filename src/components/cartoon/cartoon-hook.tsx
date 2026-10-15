"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Image as ImageIcon, Loader2, Mic, Pencil, RefreshCw, Sparkles, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { STYLES, styleName } from "@/lib/cartoon/engines";
import type { BeatStyle, CartoonBeatView, CartoonHookView, StepStatus } from "@/lib/cartoon/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo, Lightbox } from "@/components/remake/clip-video";
import { HOOK_STATUS } from "./cartoon-hooks-list";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
type Redo = "still" | "clip" | "voice" | "character" | "join";

function StepPill({ label, status, icon }: { label: string; status: StepStatus | null; icon: React.ReactNode }) {
  const tone = status === "done" ? "ok" : status === "failed" ? "bad" : status ? "run" : "muted";
  return (
    <Pill tone={tone}>
      {status === "running" ? <Loader2 size={10} className="animate-spin" /> : status === "done" ? <Check size={10} /> : icon}
      {label}
    </Pill>
  );
}

/** One hook: the joined video, the character, and every beat with its image, clip and voiceover line. */
export function CartoonHook({ id }: { id: string }) {
  const router = useRouter();
  const [hook, setHook] = useState<CartoonHookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ video?: string; image?: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHook(await api<CartoonHookView>(`/api/owner/cartoon-hooks/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const working = hook?.status === "planning" || hook?.status === "working";
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 5_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const act = async (key: string, fn: () => Promise<CartoonHookView | null | void>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      if (next) setHook(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const redo = (what: Redo, beatId?: string) =>
    act(`${what}:${beatId ?? ""}`, () => api<CartoonHookView>(`/api/owner/cartoon-hooks/${id}/redo`, { method: "POST", body: JSON.stringify({ what, beat_id: beatId }) }));

  const anotherTake = () =>
    act("take", async () => {
      if (!hook) return;
      await api("/api/owner/cartoon-hooks", {
        method: "POST",
        body: JSON.stringify({ script: hook.script, direction: hook.direction, style: hook.style, resolution: hook.resolution, voice_on: hook.voice_on, voice_provider: hook.voice_provider, voice_id: hook.voice_id, voice_type: hook.voice_type, voice_name: hook.voice_name, variants: 1, batch_id: hook.batch_id }),
      });
      router.push("/owner/cartoon-hooks");
    });

  if (!hook) {
    return (
      <div className="max-w-7xl">
        {error ? <p className="text-sm text-red-300">{error}</p> : <Loader2 size={20} className="mx-auto my-16 animate-spin text-gray-500" />}
      </div>
    );
  }

  const st = HOOK_STATUS[hook.status];
  const joining = hook.final_status === "queued" || hook.final_status === "running";

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox video={zoom.video} image={zoom.image} onClose={() => setZoom(null)} />}
      <div>
        <Link href="/owner/cartoon-hooks" className="text-xs text-gray-500 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Cartoon Hooks
        </Link>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Sparkles size={20} className="text-purple-400" /> {hook.title}
          </h1>
          <Pill tone={st.tone}>{st.label}</Pill>
          <span className="text-xs text-gray-500">
            {styleName(hook.style)} · {hook.resolution} · {hook.voice_on ? `voice: ${hook.voice_name ?? "on"}${hook.voice_provider === "elevenlabs" ? " (ElevenLabs)" : ""}` : "no voiceover"} · {timeAgo(hook.created_at)} · spent {credits(hook.credits)}
          </span>
          <span className="flex-1" />
          <Button onClick={() => void anotherTake()} busy={busy === "take"} disabled={busy !== null || hook.status === "planning"} title="Same script and settings, a different visual idea">
            <Sparkles size={12} /> Another take
          </Button>
          <ConfirmButton
            question="Delete this hook?"
            onConfirm={() => act("delete", async () => {
              await api(`/api/owner/cartoon-hooks/${id}`, { method: "DELETE" });
              router.push("/owner/cartoon-hooks");
            })}
            className="text-gray-500 hover:text-red-300 cursor-pointer p-1"
          >
            <Trash2 size={14} />
          </ConfirmButton>
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {hook.status === "planning" && (
        <Panel className="flex items-center gap-3 text-sm text-gray-300">
          <Loader2 size={16} className="animate-spin text-purple-300" /> Claude is splitting the script into beats and designing each image. About half a minute.
        </Panel>
      )}
      {hook.status === "failed" && (
        <Panel className="flex items-center gap-3 flex-wrap text-sm">
          <AlertTriangle size={16} className="text-red-300" />
          <span className="text-red-200">{hook.error ?? "Planning failed"}</span>
          <Button onClick={() => void act("replan", () => api<CartoonHookView>(`/api/owner/cartoon-hooks/${id}`, { method: "POST", body: JSON.stringify({ action: "replan" }) }))} busy={busy === "replan"}>
            <RefreshCw size={12} /> Plan again
          </Button>
        </Panel>
      )}

      {hook.beats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-4 lg:sticky lg:top-4">
            <Panel className="space-y-2">
              <Label>The hook</Label>
              <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
                {hook.final_url && !joining ? (
                  <ClipVideo src={hook.final_url} poster={hook.cover_url} className="h-full" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center p-3">
                    {hook.final_status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className={joining ? "animate-spin text-purple-300" : "text-gray-600"} />}
                    <p className="text-[11px] text-gray-300">
                      {joining ? "Joining the beats…" : hook.final_status === "failed" ? hook.final_error ?? "Join failed" : `Joins itself when all ${hook.beats.length} clips are in (${hook.clips_done} so far)`}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                {hook.final_url && (
                  <a href={hook.final_url} download className="text-gray-200 hover:text-white inline-flex items-center gap-1">
                    <Download size={11} /> Download MP4
                  </a>
                )}
                {hook.final_seconds && <span className="text-gray-500">{hook.final_seconds} s</span>}
                {(hook.final_status === "done" || hook.final_status === "failed") && (
                  <button type="button" onClick={() => void redo("join")} className="ml-auto text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Join the current clips again">
                    <RefreshCw size={11} /> Rejoin
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-600">No captions on purpose: add them in CapCut. Each beat&apos;s own clip can be downloaded below too.</p>
            </Panel>

            {hook.character_prompt && (
              <Panel className="space-y-2">
                <Label>Main character</Label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => hook.character_url && setZoom({ image: hook.character_url })} className="shrink-0 w-20 aspect-[9/16] rounded-lg overflow-hidden bg-black cursor-zoom-in">
                    {hook.character_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={hook.character_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center">{hook.character_status === "failed" ? <AlertTriangle size={14} className="text-red-300" /> : <Loader2 size={14} className="animate-spin text-purple-300" />}</span>
                    )}
                  </button>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] text-gray-400 line-clamp-6" title={hook.character_desc}>
                      {hook.character_desc}
                    </p>
                    {hook.character_error && <p className="text-[10px] text-red-300 line-clamp-3">{hook.character_error}</p>}
                  </div>
                </div>
                <ConfirmButton question="Redraw it and every beat with it?" label="Redraw" onConfirm={() => void redo("character")} className="text-[11px] text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                  <RefreshCw size={11} /> Redraw character
                </ConfirmButton>
              </Panel>
            )}

            <Panel>
              <Label>Script</Label>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{hook.script}</p>
              {hook.direction && <p className="text-[11px] text-gray-500 mt-2">Notes: {hook.direction}</p>}
            </Panel>
          </div>

          <Panel>
            <Label>Beats · {hook.beats.length}</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {hook.beats.map((b) => (
                <BeatCard
                  key={b.id}
                  beat={b}
                  voiceOn={hook.voice_on}
                  busy={busy}
                  editing={editing === b.id}
                  onEdit={() => setEditing(editing === b.id ? null : b.id)}
                  onZoom={setZoom}
                  onRedo={(what) => void redo(what, b.id)}
                  onSave={(patch, thenRedo) =>
                    act(`save:${b.id}`, async () => {
                      let next = await api<CartoonHookView>(`/api/owner/cartoon-hooks/${id}/beats/${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
                      if (thenRedo) next = await api<CartoonHookView>(`/api/owner/cartoon-hooks/${id}/redo`, { method: "POST", body: JSON.stringify({ what: thenRedo, beat_id: b.id }) });
                      setEditing(null);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

interface BeatPatch {
  line: string;
  seconds: number;
  scene: string;
  motion: string;
  style: BeatStyle;
  uses_character: boolean;
}

function BeatCard({
  beat: b,
  voiceOn,
  busy,
  editing,
  onEdit,
  onZoom,
  onRedo,
  onSave,
}: {
  beat: CartoonBeatView;
  voiceOn: boolean;
  busy: string | null;
  editing: boolean;
  onEdit: () => void;
  onZoom: (z: { video?: string; image?: string }) => void;
  onRedo: (what: "still" | "clip" | "voice") => void;
  onSave: (patch: BeatPatch, thenRedo: "still" | "clip" | null) => void;
}) {
  const fromBeat = (): BeatPatch => ({ line: b.line, seconds: Number(b.seconds), scene: b.scene, motion: b.motion, style: b.style, uses_character: b.uses_character });
  const [draft, setDraft] = useState<BeatPatch>(fromBeat);
  const startEdit = () => {
    setDraft(fromBeat());
    onEdit();
  };

  const stillBusy = b.still_status === "queued" || b.still_status === "running";
  const clipBusy = b.clip_status === "queued" || b.clip_status === "running";
  const len = voiceOn && b.voice_seconds ? Number(b.voice_seconds) : Number(b.seconds);
  const err = b.still_error || b.clip_error || b.voice_error;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-2 flex flex-col gap-1.5">
      <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
        {b.clip_url && !clipBusy ? (
          <ClipVideo src={b.clip_url} poster={b.still_preview_url} className="h-full" />
        ) : b.still_preview_url ? (
          <button type="button" onClick={() => onZoom({ image: b.still_url ?? b.still_preview_url! })} className="w-full h-full cursor-zoom-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.still_preview_url} alt="" className={`w-full h-full object-cover ${stillBusy ? "opacity-40" : ""}`} />
          </button>
        ) : null}
        {(stillBusy || clipBusy || (!b.still_preview_url && !b.still_status)) && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-gray-200 px-2 py-1 flex items-center gap-1.5 pointer-events-none">
            <Loader2 size={10} className="animate-spin" />
            {stillBusy ? "Drawing the image…" : clipBusy ? (b.clip_status === "running" ? "Animating, ~2 min…" : "Clip queued…") : b.uses_character ? "Waiting for the character" : "Waiting"}
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
          {b.idx + 1} · {len.toFixed(1)}s
        </span>
      </div>
      <p className="text-[12px] text-white leading-snug">“{b.line}”</p>
      <div className="flex items-center gap-1 flex-wrap">
        <StepPill label="Image" status={b.still_status} icon={<ImageIcon size={10} />} />
        <StepPill label="Clip" status={b.clip_status} icon={<Video size={10} />} />
        {voiceOn && <StepPill label="Voice" status={b.voice_status} icon={<Mic size={10} />} />}
        <span className="text-[10px] text-gray-600">{styleName(b.style)}</span>
      </div>
      {err && <p className="text-[10px] text-red-300 line-clamp-3" title={err}>{err}</p>}

      {editing ? (
        <div className="space-y-1.5 pt-1">
          <textarea value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} rows={2} className={`${field} resize-none`} title="The voiceover words for this beat" />
          <textarea value={draft.scene} onChange={(e) => setDraft({ ...draft, scene: e.target.value })} rows={4} className={`${field} resize-y`} title="What the image shows" />
          <textarea value={draft.motion} onChange={(e) => setDraft({ ...draft, motion: e.target.value })} rows={2} className={`${field} resize-y`} title="What moves in the clip" />
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <select value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value as BeatStyle })} className="bg-gray-900 border border-gray-700 rounded-md px-1.5 py-1 text-[11px] text-gray-300">
              {STYLES.filter((s) => s.id !== "mixed").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input type="number" step={0.1} min={1} max={6} value={draft.seconds} onChange={(e) => setDraft({ ...draft, seconds: Number(e.target.value) })} className="w-14 bg-gray-900 border border-gray-700 rounded-md px-1.5 py-1 text-[11px] text-white" title="Seconds (the voiceover's length wins when it is on)" />
            <label className="inline-flex items-center gap-1 text-gray-400">
              <input type="checkbox" checked={draft.uses_character} onChange={(e) => setDraft({ ...draft, uses_character: e.target.checked })} className="accent-purple-500" /> character
            </label>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button primary onClick={() => onSave(draft, "still")} busy={busy === `save:${b.id}`} className="!px-2 !py-1 !text-[11px]">
              Save and redraw
            </Button>
            <Button onClick={() => onSave(draft, "clip")} disabled={busy !== null} className="!px-2 !py-1 !text-[11px]" title="Keep the image, animate it again with the new motion">
              Re-animate
            </Button>
            <Button ghost onClick={() => onSave(draft, null)} disabled={busy !== null} className="!px-2 !py-1 !text-[11px]">
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] mt-auto flex-wrap">
          <button type="button" onClick={startEdit} className="text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
            <Pencil size={11} /> Edit
          </button>
          <button type="button" onClick={() => onRedo("still")} disabled={stillBusy} className="text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40" title="New image (and a new clip from it)">
            <RefreshCw size={11} /> Image
          </button>
          <button type="button" onClick={() => onRedo("clip")} disabled={clipBusy || b.still_status !== "done"} className="text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40" title="Animate the same image again">
            <RefreshCw size={11} /> Clip
          </button>
          {voiceOn && (
            <button type="button" onClick={() => onRedo("voice")} className="text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Say the line again">
              <RefreshCw size={11} /> Voice
            </button>
          )}
          {b.clip_url && (
            <a href={b.clip_url} download className="ml-auto text-gray-400 hover:text-white" title="Download this beat's clip">
              <Download size={11} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
