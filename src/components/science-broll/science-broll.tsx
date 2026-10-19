"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Image as ImageIcon, Loader2, Microscope, RefreshCw, ShieldCheck, Sparkles, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CartoonBeatView, CartoonHookView, StepStatus } from "@/lib/cartoon/types";
import { moveById } from "@/lib/science-broll/engines";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo, Lightbox } from "@/components/remake/clip-video";
import { PROJECT_STATUS } from "./science-broll-list";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

function StepPill({ label, status, icon }: { label: string; status: StepStatus | null; icon: React.ReactNode }) {
  const tone = status === "done" ? "ok" : status === "failed" ? "bad" : status ? "run" : "muted";
  return (
    <Pill tone={tone}>
      {status === "running" ? <Loader2 size={10} className="animate-spin" /> : status === "done" ? <Check size={10} /> : icon}
      {label}
    </Pill>
  );
}

/** One set: the joined video, the style anchor, and every beat with its still, check and clip. */
export function ScienceBroll({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<CartoonHookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ video?: string; image?: string } | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; note: string } | null>(null);
  const [anchorNote, setAnchorNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      setProject(await api<CartoonHookView>(`/api/owner/science-broll/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const working = project?.status === "planning" || project?.status === "working";
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 5_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const act = async (key: string, fn: () => Promise<CartoonHookView | null | void>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      if (next) setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const redo = (what: "still" | "clip" | "character" | "join", beatId?: string, note?: string) =>
    act(`${what}:${beatId ?? ""}`, async () => {
      const next = await api<CartoonHookView>(`/api/owner/science-broll/${id}/redo`, { method: "POST", body: JSON.stringify({ what, beat_id: beatId, note }) });
      setNoteFor(null);
      setAnchorNote("");
      return next;
    });

  const approveAnchor = () => act("approve", () => api<CartoonHookView>(`/api/owner/science-broll/${id}`, { method: "POST", body: JSON.stringify({ action: "approve_anchor" }) }));

  const anotherTake = () =>
    act("take", async () => {
      if (!project) return;
      await api("/api/owner/science-broll", { method: "POST", body: JSON.stringify({ text: project.script, direction: project.direction, resolution: project.resolution, variants: 1, batch_id: project.batch_id }) });
      router.push("/owner/science-broll");
    });

  if (!project) {
    return <div className="max-w-7xl">{error ? <p className="text-sm text-red-300">{error}</p> : <Loader2 size={20} className="mx-auto my-16 animate-spin text-gray-500" />}</div>;
  }

  const st = PROJECT_STATUS[project.status];
  const joining = project.final_status === "queued" || project.final_status === "running";
  const checked = project.beats.filter((b) => b.check_status === "done").length;
  const anchorChecked = project.anchor_check_status === "done";
  const anchorDrawn = project.character_status === "done" && !!project.character_url && anchorChecked;
  const anchorBusy = project.character_status === "queued" || project.character_status === "running" || (project.character_status === "done" && !anchorChecked);
  const anchorStep = project.character_status === "queued" || project.character_status === "running" ? (project.anchor_auto_redos > 0 ? "Redrawing the anchor after the check…" : "Drawing the anchor…") : project.character_status === "done" && !anchorChecked ? "Claude is checking the anchor…" : null;
  const waitingOk = project.status === "working" && !project.anchor_approved;

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox video={zoom.video} image={zoom.image} onClose={() => setZoom(null)} />}
      <div>
        <Link href="/owner/science-broll" className="text-xs text-gray-500 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Science B-roll
        </Link>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Microscope size={20} className="text-purple-400" /> {project.title}
          </h1>
          <Pill tone={st.tone}>{st.label}</Pill>
          <span className="text-xs text-gray-500">
            {project.resolution} · {timeAgo(project.created_at)} · spent {credits(project.credits)}
          </span>
          <span className="flex-1" />
          <Button onClick={() => void anotherTake()} busy={busy === "take"} disabled={busy !== null || project.status === "planning"} title="Same text and settings, a different visual idea">
            <Sparkles size={12} /> Another take
          </Button>
          <ConfirmButton
            question="Delete this set?"
            onConfirm={() =>
              act("delete", async () => {
                await api(`/api/owner/science-broll/${id}`, { method: "DELETE" });
                router.push("/owner/science-broll");
              })
            }
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

      {project.status === "planning" && (
        <Panel className="flex items-center gap-3 text-sm text-gray-300">
          <Loader2 size={16} className="animate-spin text-purple-300" /> Claude is splitting the text into shots and picking a move for each. About half a minute.
        </Panel>
      )}
      {waitingOk && anchorDrawn && (
        <Panel className="flex items-center gap-3 flex-wrap text-sm border-amber-500/40">
          <ShieldCheck size={16} className="text-amber-300" />
          <span className="text-amber-100">The style anchor is drawn. Approve it and the stills are drawn from it; or redraw it as a different take first.</span>
          <Button primary onClick={() => void approveAnchor()} busy={busy === "approve"} disabled={busy !== null}>
            <Check size={12} /> Approve the anchor
          </Button>
        </Panel>
      )}
      {project.status === "failed" && (
        <Panel className="flex items-center gap-3 flex-wrap text-sm">
          <AlertTriangle size={16} className="text-red-300" />
          <span className="text-red-200">{project.error ?? "Planning failed"}</span>
          <Button onClick={() => void act("replan", () => api<CartoonHookView>(`/api/owner/science-broll/${id}`, { method: "POST", body: JSON.stringify({ action: "replan" }) }))} busy={busy === "replan"}>
            <RefreshCw size={12} /> Plan again
          </Button>
        </Panel>
      )}

      {project.beats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-4 lg:sticky lg:top-4">
            <Panel className="space-y-2">
              <Label>Joined set</Label>
              <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
                {project.final_url && !joining ? (
                  <ClipVideo src={project.final_url} poster={project.cover_url} className="h-full" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center p-3">
                    {project.final_status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className={joining ? "animate-spin text-purple-300" : "text-gray-600"} />}
                    <p className="text-[11px] text-gray-300">
                      {joining ? "Joining the clips…" : project.final_status === "failed" ? project.final_error ?? "Join failed" : `Joins itself when all ${project.beats.length} clips are in (${project.clips_done} so far)`}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                {project.final_url && (
                  <a href={project.final_url} download className="text-gray-200 hover:text-white inline-flex items-center gap-1">
                    <Download size={11} /> Download MP4
                  </a>
                )}
                {project.final_seconds && <span className="text-gray-500">{project.final_seconds} s</span>}
                {(project.final_status === "done" || project.final_status === "failed") && (
                  <button type="button" onClick={() => void redo("join")} className="ml-auto text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Join the current clips again">
                    <RefreshCw size={11} /> Rejoin
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-600">Each clip can be downloaded on its own from the beats. No captions on purpose: add them in CapCut.</p>
            </Panel>

            <Panel className="space-y-2">
              <Label>
                Style anchor{project.anchor_approved ? " · approved" : anchorDrawn ? " · needs your OK" : anchorStep ? " · " + anchorStep.replace("…", "") : ""}
                {project.anchor_redos > 0 ? ` · take ${project.anchor_redos + 1}` : ""}
              </Label>
              <div className="flex gap-3">
                <button type="button" onClick={() => project.character_url && setZoom({ image: project.character_url })} className="shrink-0 w-28 aspect-[9/16] rounded-lg overflow-hidden bg-black cursor-zoom-in">
                  {project.character_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={project.character_url} alt="" className={`w-full h-full object-cover ${anchorBusy ? "opacity-40" : ""}`} />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center">{project.character_status === "failed" ? <AlertTriangle size={14} className="text-red-300" /> : <Loader2 size={14} className="animate-spin text-purple-300" />}</span>
                  )}
                </button>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[11px] text-gray-400 line-clamp-6">The subject at rest, nothing happening: it sets the look every still is matched to. Claude checks it for coherent anatomy before you see it. Nothing is drawn until you approve it.</p>
                  {anchorStep && (
                    <p className="text-[11px] text-purple-300 inline-flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> {anchorStep}
                    </p>
                  )}
                  {project.anchor_check_status === "done" && project.anchor_check_ok === false && project.anchor_check_notes && <p className="text-[10px] text-amber-300 line-clamp-3">{project.anchor_check_notes}</p>}
                  {project.anchor_check_status === "done" && project.anchor_check_ok && project.anchor_auto_redos > 0 && <p className="text-[10px] text-gray-500">Redrawn once by the check</p>}
                  {project.anchor_note && <p className="text-[10px] text-gray-500 line-clamp-3">Last note: {project.anchor_note}</p>}
                  {project.character_error && <p className="text-[10px] text-red-300 line-clamp-3">{project.character_error}</p>}
                </div>
              </div>
              {!project.anchor_approved && anchorDrawn && (
                <Button primary onClick={() => void approveAnchor()} busy={busy === "approve"} disabled={busy !== null} className="w-full justify-center">
                  <Check size={12} /> Approve the anchor
                </Button>
              )}
              <div className="space-y-1.5">
                <input value={anchorNote} onChange={(e) => setAnchorNote(e.target.value)} placeholder="Redraw note (optional): more high-tech, closer on the follicle, glassy…" className={field} disabled={anchorBusy} />
                <Button
                  ghost={!anchorDrawn || project.anchor_approved}
                  onClick={() => void redo("character", undefined, anchorNote)}
                  busy={busy === "character:"}
                  disabled={busy !== null || anchorBusy}
                  className="w-full justify-center !text-[11px]"
                  title={project.anchor_approved ? "Every still is redrawn from the new anchor after your OK" : "A different take each time"}
                >
                  <RefreshCw size={11} /> {anchorNote.trim() ? "Redraw with this note" : "Redraw as a different take"}
                </Button>
                <p className="text-[10px] text-gray-600">Without a note, each redraw tries a different look: high-tech animation frame, closer and dramatic, clean plate, glassy premium.</p>
              </div>
            </Panel>

            <Panel>
              <Label>Text</Label>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{project.script}</p>
              {project.direction && <p className="text-[11px] text-gray-500 mt-2">Notes: {project.direction}</p>}
            </Panel>
          </div>

          <Panel>
            <Label>
              Beats · {project.beats.length} · checked {checked}/{project.beats.length}
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {project.beats.map((b) => (
                <BeatCard
                  key={b.id}
                  beat={b}
                  busy={busy}
                  anchorApproved={project.anchor_approved}
                  note={noteFor?.id === b.id ? noteFor.note : null}
                  onNote={(note) => setNoteFor(note === null ? null : { id: b.id, note })}
                  onZoom={setZoom}
                  onRedo={(what, note) => void redo(what, b.id, note)}
                />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function BeatCard({
  beat: b,
  busy,
  anchorApproved,
  note,
  onNote,
  onZoom,
  onRedo,
}: {
  beat: CartoonBeatView;
  busy: string | null;
  anchorApproved: boolean;
  /** The redo note being typed for this beat, or null when the box is closed. */
  note: string | null;
  onNote: (note: string | null) => void;
  onZoom: (z: { video?: string; image?: string }) => void;
  onRedo: (what: "still" | "clip", note?: string) => void;
}) {
  const move = moveById(b.move);
  const stillBusy = b.still_status === "queued" || b.still_status === "running";
  const checking = b.check_status === "queued" || b.check_status === "running";
  const clipBusy = b.clip_status === "queued" || b.clip_status === "running";
  const waitingCheck = b.still_status === "done" && b.check_status === null;
  const err = b.still_error || b.clip_error;
  const checkTone = b.check_status !== "done" ? "muted" : b.check_ok === true ? "ok" : b.check_ok === false ? "warn" : "muted";

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
        {(stillBusy || checking || waitingCheck || clipBusy || (!b.still_preview_url && !b.still_status)) && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-gray-200 px-2 py-1 flex items-center gap-1.5 pointer-events-none">
            <Loader2 size={10} className="animate-spin" />
            {stillBusy ? (b.still_redos > 0 ? "Redrawing after the check…" : "Drawing the still…") : checking || waitingCheck ? "Claude is checking the still…" : clipBusy ? (b.clip_status === "running" ? "Animating, ~2 min…" : "Clip queued…") : anchorApproved ? "Waiting for the style anchor" : "Waiting for your OK on the anchor"}
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
          {b.idx + 1} · {Number(b.seconds).toFixed(0)}s · {move.name}
        </span>
      </div>
      {b.line && <p className="text-[12px] text-white leading-snug">“{b.line}”</p>}
      <p className="text-[11px] text-gray-400 line-clamp-3" title={b.scene}>
        {b.scene}
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        <StepPill label="Still" status={b.still_status} icon={<ImageIcon size={10} />} />
        <Pill tone={checkTone}>
          {checking ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
          {b.check_status === "done" ? (b.check_ok ? "Checked" : b.check_ok === false ? "Flagged" : "Not checked") : "Check"}
        </Pill>
        <StepPill label="Clip" status={b.clip_status} icon={<Video size={10} />} />
      </div>
      {b.check_notes && b.check_status === "done" && b.check_ok !== true && <p className="text-[10px] text-amber-300 line-clamp-3" title={b.check_notes}>{b.check_notes}</p>}
      {b.check_notes && b.still_redos > 0 && b.check_ok === true && <p className="text-[10px] text-gray-500">Redrawn once by the check</p>}
      {err && <p className="text-[10px] text-red-300 line-clamp-3" title={err}>{err}</p>}

      {note !== null ? (
        <div className="space-y-1.5 pt-1">
          <input autoFocus value={note} onChange={(e) => onNote(e.target.value)} placeholder="What should change? e.g. gut wall instead of stomach, more red, no capsule" className={field} onKeyDown={(e) => e.key === "Enter" && note.trim() && onRedo("still", note)} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button primary onClick={() => onRedo("still", note)} busy={busy === `still:${b.id}`} disabled={!note.trim() || busy !== null} className="!px-2 !py-1 !text-[11px]">
              Redraw
            </Button>
            <Button ghost onClick={() => onNote(null)} disabled={busy !== null} className="!px-2 !py-1 !text-[11px]">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] mt-auto flex-wrap">
          <button type="button" onClick={() => onNote("")} disabled={stillBusy} className="text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40" title="Redraw the still with a note (the check and a new clip follow)">
            <RefreshCw size={11} /> Redraw with a note
          </button>
          <button type="button" onClick={() => onRedo("clip")} disabled={clipBusy || b.still_status !== "done"} className="text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40" title="Animate the same still again">
            <RefreshCw size={11} /> Clip
          </button>
          {b.clip_url && (
            <a href={b.clip_url} download className="ml-auto text-gray-400 hover:text-white inline-flex items-center gap-1" title="Download this clip">
              <Download size={11} /> MP4
            </a>
          )}
        </div>
      )}
    </div>
  );
}
