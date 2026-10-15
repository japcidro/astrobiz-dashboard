"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Link2, Loader2, Merge, Scissors, Trash2, Video, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import type { BoardView } from "@/lib/marketing-board/types";
import { STILL_CREDITS, clipEstimate, getClipEngine, veoLengthFor } from "@/lib/remake/engines";
import type { BrandKit, CastSource, ProjectView, ShotView } from "@/lib/remake/types";
import { Button, ConfirmButton, Pill, api, credits } from "@/components/hook-studio/ui";
import { CastBrandPanel } from "./cast-brand-panel";
import { ClipVideo } from "./clip-video";
import { ShotPanel } from "./shot-panel";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function shotBusy(s: ShotView) {
  return [s.still_status, s.audio_status, s.clip_status, s.mixed_status].some((x) => x === "queued" || x === "running");
}

type TrayMode = "ref" | "ours" | "both";

/** The Clipper workspace: reference and timeline on top, the chosen clip in the middle, cast and brand on the right, the tray below. */
export function RemakeProject({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [tray, setTray] = useState<TrayMode>("both");
  const refVideo = useRef<HTMLVideoElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ project: ProjectView }>(`/api/owner/remake/projects/${id}`);
      setProject(r.project);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    api<BoardView>("/api/owner/marketing-board").then((b) => setStores(b.stores)).catch(() => {});
    const load = () => api<WorkerStatus>("/api/owner/hook-studio/status").then(setWorker).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const working = !!project && (project.status === "splitting" || project.status === "classifying" || project.shots.some(shotBusy) || project.shots.some((s) => s.brand_check?.notes === "Checking…" || !s.ref_path));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 6_000 : 45_000);
    return () => clearInterval(t);
  }, [working, refresh]);

  useEffect(() => {
    if (project && (!selected || !project.shots.some((s) => s.id === selected)) && project.shots.length) setSelected(project.shots[0].id);
  }, [project, selected]);

  const call = async (label: string, fn: () => Promise<{ project: ProjectView }>) => {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      setProject(r.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };
  const patchProject = (body: Record<string, unknown>) => call("project", () => api(`/api/owner/remake/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }));
  const patchShot = (shotId: string, body: Record<string, unknown>) =>
    call("approved" in body ? "approve" : "shot", () => api(`/api/owner/remake/projects/${id}/shots/${shotId}`, { method: "PATCH", body: JSON.stringify(body) }));
  const action = (shotId: string, a: string, body?: Record<string, unknown>) =>
    call(a, () => api(`/api/owner/remake/projects/${id}/shots/${shotId}/${a}`, { method: "POST", body: JSON.stringify(body ?? {}) }));

  const castFrom = (body: CastSource) =>
    call("cast", () => api(`/api/owner/remake/projects/${id}/cast`, { method: "POST", body: JSON.stringify(body) }));

  const renderAll = async () => {
    if (!project) return;
    const ready = project.shots.filter((s) => s.selected && s.mode === "swap" && s.approved && s.still_status === "done" && s.clip_status !== "done" && !shotBusy(s));
    for (const s of ready) await action(s.id, "clip");
  };

  const attach = async () => {
    setBusy("attach");
    try {
      const r = await api<{ attached: number }>(`/api/owner/remake/projects/${id}/attach`, { method: "POST" });
      setAttachMsg(r.attached ? `${r.attached} clip${r.attached === 1 ? "" : "s"} attached to the board card` : "Everything was already attached");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    try {
      await api(`/api/owner/remake/projects/${id}`, { method: "DELETE" });
      router.push("/owner/clipper");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const shot = project?.shots.find((s) => s.id === selected) ?? null;
  const duration = Number(project?.source_duration ?? 0);
  const atPlayhead = project?.shots.find((s) => playhead >= Number(s.start_s) && playhead < Number(s.end_s)) ?? null;

  const seek = (t: number) => {
    setPlayhead(t);
    if (refVideo.current) refVideo.current.currentTime = t;
    const s = project?.shots.find((x) => t >= Number(x.start_s) && t < Number(x.end_s));
    if (s) setSelected(s.id);
  };

  const people = useMemo(() => Array.from(new Set((project?.shots ?? []).map((s) => s.person).filter((p): p is string => !!p))).sort(), [project]);
  const setPersonMode = async (person: string, mode: "keep" | "swap") => {
    if (!project) return;
    for (const s of project.shots.filter((x) => x.person === person && x.mode !== mode)) await patchShot(s.id, { mode });
  };

  const totals = useMemo(() => {
    if (!project) return { planned: 0, spent: 0, ready: 0, selected: 0 };
    let planned = 0;
    let spent = 0;
    let ready = 0;
    for (const s of project.shots) {
      if (!s.selected) continue;
      if (s.mode === "keep") {
        if (s.ref_path) ready++;
        continue;
      }
      if (s.still_status !== "done") planned += STILL_CREDITS;
      if (s.clip_status === "done") {
        spent += Number(s.clip_credits ?? 0);
        ready++;
      } else {
        const e = getClipEngine(s.clip_engine);
        planned += clipEstimate(s.clip_engine, s.clip_quality, e?.lengths ? (e.id === "veo3" ? 8 : Number(s.clip_seconds) || veoLengthFor(s.seconds)) : s.seconds);
      }
    }
    return { planned: Math.round(planned), spent: Math.round(spent * 10) / 10, ready, selected: project.shots.filter((s) => s.selected).length };
  }, [project]);

  if (!project) {
    return (
      <div className="max-w-6xl">
        <Link href="/owner/clipper" className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Clipper
        </Link>
        {error ? <p className="mt-6 text-sm text-red-300">{error}</p> : <Loader2 size={20} className="mt-10 mx-auto animate-spin text-gray-500" />}
      </div>
    );
  }

  const exported = project.shots.filter((s) => s.selected);

  return (
    <div className="max-w-7xl">
      <Link href="/owner/clipper" className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Clipper
      </Link>
      <div className="mt-2 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <input
            defaultValue={project.title}
            key={`${project.id}-title`}
            onBlur={(e) => e.target.value.trim() !== project.title && void patchProject({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full bg-transparent text-2xl font-bold text-white focus:outline-none border-b border-transparent focus:border-gray-600"
          />
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
            {duration > 0 && <span>{fmt(duration)} reference</span>}
            <span>· {project.shots.length} clips, {totals.selected} to export</span>
            {project.board_item_title && <span>· from board card “{project.board_item_title}”</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {project.status === "splitting" && <Pill tone="run"><Loader2 size={11} className="animate-spin" /> Cutting into clips</Pill>}
          {project.status === "classifying" && <Pill tone="run"><Loader2 size={11} className="animate-spin" /> Labelling clips</Pill>}
          {project.status === "failed" && <Pill tone="bad"><AlertTriangle size={11} /> {project.error ?? "Failed"}</Pill>}
          <Pill tone="muted">{credits(totals.spent)} spent · ≈ {credits(totals.planned)} planned</Pill>
          {worker && !worker.online && <Pill tone="bad">Mac worker offline</Pill>}
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-300 bg-red-900/30 border border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

      {project.status === "splitting" || (project.status === "failed" && project.shots.length === 0) ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-800 p-10 text-center text-sm text-gray-400">
          {project.status === "failed" ? project.error : "The Mac is cutting the reference into clips. This takes about a minute."}
        </div>
      ) : (
        <>
          {/* Reference + timeline */}
          <section className="mt-5 rounded-xl border border-gray-800 bg-gray-900/40 p-3 grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)] gap-3">
            <div className="aspect-[9/16] w-[120px]">
              {project.source_url ? (
                <video ref={refVideo} src={project.source_url} controls playsInline preload="metadata" onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} className="w-full h-full rounded-lg bg-black object-cover" />
              ) : (
                <div className="w-full h-full rounded-lg bg-gray-950" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-gray-500 mb-1.5">Timeline · one frame per second · click to seek, then split at the playhead. Purple lines are clip starts.</p>
              <div
                className="relative w-full overflow-hidden rounded-md bg-gray-950 cursor-crosshair select-none"
                onClick={(e) => {
                  if (!duration) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  seek(Math.max(0, Math.min(duration - 0.1, ((e.clientX - r.left) / r.width) * duration)));
                }}
              >
                {project.strip_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.strip_url} alt="" className="w-full h-[88px] object-cover object-left block" draggable={false} />
                ) : (
                  <div className="h-[88px]" />
                )}
                {duration > 0 &&
                  project.shots.map((s) => (
                    <div
                      key={s.id}
                      className={`absolute inset-y-0 border-l-2 ${s.id === selected ? "border-purple-400" : "border-purple-600/80"}`}
                      style={{ left: `${(Number(s.start_s) / duration) * 100}%` }}
                      title={`Clip ${s.idx + 1}`}
                    >
                      <span className="absolute top-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">{s.idx + 1}{s.person ? ` ${s.person}` : ""}</span>
                    </div>
                  ))}
                {duration > 0 && <div className="absolute inset-y-0 w-px bg-white" style={{ left: `${(playhead / duration) * 100}%` }} />}
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400 tabular-nums">{playhead.toFixed(1)}s{atPlayhead ? ` · clip ${atPlayhead.idx + 1}` : ""}</span>
                <Button onClick={() => atPlayhead && action(atPlayhead.id, "split", { at: playhead })} busy={busy === "split"} disabled={!atPlayhead}>
                  <Scissors size={13} /> Split at playhead
                </Button>
                <Button onClick={() => shot && action(shot.id, "merge")} busy={busy === "merge"} disabled={!shot || shot.idx === project.shots.length - 1}>
                  <Merge size={13} /> Merge clip {shot ? shot.idx + 1 : ""} with next
                </Button>
                <ConfirmButton
                  question="Replace all clips?"
                  label="Re-detect"
                  onConfirm={() => call("redetect", () => api(`/api/owner/remake/projects/${id}/redetect`, { method: "POST" }))}
                  className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold bg-gray-700/70 hover:bg-gray-700 text-white border border-gray-600 cursor-pointer"
                >
                  {busy === "redetect" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Re-detect people changes
                </ConfirmButton>
                {people.length > 0 && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-400">
                    {people.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 rounded-full border border-gray-700 pl-2 pr-1 py-0.5">
                        Person {p}
                        <button type="button" onClick={() => void setPersonMode(p, "swap")} className="px-1.5 rounded-full hover:bg-purple-600/40 text-purple-300 cursor-pointer">swap all</button>
                        <button type="button" onClick={() => void setPersonMode(p, "keep")} className="px-1.5 rounded-full hover:bg-white/10 cursor-pointer">keep all</button>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </section>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_280px] gap-4">
            <aside className="space-y-1.5">
              {project.shots.map((s) => {
                const thumb = s.still_preview_url ?? s.frame_url;
                const bad = s.brand_check && !s.brand_check.ok && s.brand_check.notes !== "Checking…";
                const done = s.mode === "keep" ? !!s.ref_path : s.clip_status === "done";
                return (
                  <button key={s.id} type="button" onClick={() => setSelected(s.id)} className={`w-full flex items-center gap-2 rounded-lg border p-1.5 text-left cursor-pointer ${s.id === selected ? "border-purple-500 bg-purple-500/10" : "border-gray-800 bg-gray-900/40 hover:bg-gray-800/60"} ${s.selected ? "" : "opacity-60"}`}>
                    <div className="w-8 shrink-0 aspect-[9/16] rounded bg-gray-950 overflow-hidden">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white">
                        {s.idx + 1} · {fmt(Number(s.start_s))}–{fmt(Number(s.end_s))}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {s.mode === "swap" ? "Swap" : "Keep"} · {s.kind === "talking_head" ? "talking" : "b-roll"}{s.person ? ` · ${s.person}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-gray-500">
                      {shotBusy(s) ? <Loader2 size={12} className="animate-spin" /> : done ? <Check size={12} className="text-green-400" /> : bad ? <AlertTriangle size={12} className="text-red-300" /> : s.approved ? <Check size={12} className="text-gray-400" /> : null}
                    </span>
                  </button>
                );
              })}
            </aside>

            <main className="min-w-0">
              {shot ? (
                <ShotPanel key={shot.id} project={project} shot={shot} busy={busy} onPatch={(b) => patchShot(shot.id, b)} onAction={(a, b) => action(shot.id, a, b)} onProjectPatch={patchProject} onCastFrom={castFrom} />
              ) : (
                <p className="text-sm text-gray-500">Pick a clip.</p>
              )}
            </main>

            <CastBrandPanel key={project.store ?? ""} project={project} stores={stores} onPatch={patchProject} onKit={(kit: BrandKit) => setProject((p) => (p ? { ...p, brand_kit: kit } : p))} onError={setError} />
          </div>

          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white">
                Clips tray <span className="text-gray-500 font-normal">· {totals.ready} of {totals.selected} ready, in reference order</span>
              </h2>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 p-0.5 ml-2">
                {(["ref", "ours", "both"] as TrayMode[]).map((m) => (
                  <button key={m} type="button" onClick={() => setTray(m)} className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${tray === m ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {m === "ref" ? "Reference" : m === "ours" ? "Ours" : "Side by side"}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <Button onClick={renderAll} disabled={busy !== null}>
                <Video size={13} /> Render all approved
              </Button>
              {project.board_item_id && (
                <Button onClick={attach} busy={busy === "attach"} disabled={totals.ready === 0}>
                  <Link2 size={13} /> Attach to board card
                </Button>
              )}
              <ConfirmButton onConfirm={remove} question="Delete this project and its files?" className="text-xs text-gray-400 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer px-2">
                <Trash2 size={12} /> Delete
              </ConfirmButton>
            </div>
            {attachMsg && <p className="text-xs text-green-400 mt-2">{attachMsg}</p>}
            <div className={`mt-3 grid gap-2 ${tray === "both" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-8"}`}>
              {exported.map((s) => {
                const ours = s.final_url;
                const cell = (src: string | null, label: string) =>
                  src ? (
                    <ClipVideo src={src} hoverOnly label={label} className="aspect-[9/16]" />
                  ) : (
                    <button type="button" onClick={() => setSelected(s.id)} className={`aspect-[9/16] w-full rounded-lg border ${s.clip_status === "failed" ? "border-red-800/60" : "border-dashed border-gray-700"} bg-gray-950 flex items-center justify-center text-gray-600 cursor-pointer`}>
                      {shotBusy(s) ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[10px] px-2 text-center">{label}</span>}
                    </button>
                  );
                return (
                  <div key={s.id} className="text-center">
                    {tray === "both" ? (
                      <div className="grid grid-cols-2 gap-1">
                        {cell(s.ref_url, "Reference")}
                        {cell(ours, s.mode === "keep" ? "Kept" : "Ours")}
                      </div>
                    ) : tray === "ref" ? (
                      cell(s.ref_url, "Reference")
                    ) : (
                      cell(ours, s.mode === "keep" ? "Kept" : "Ours")
                    )}
                    <p className="text-[10px] text-gray-500 mt-1 truncate">
                      {s.idx + 1} · {s.mode === "keep" ? "original" : s.clip_status === "done" ? `${getClipEngine(s.clip_engine)?.name ?? ""}` : s.clip_status === "failed" ? "failed" : shotBusy(s) ? "working" : s.approved ? "approved" : s.still_status === "done" ? "review still" : "no still"}
                      {s.mixed_status === "done" ? " + VO" : ""}
                    </p>
                    {ours && (
                      <a href={ours} download className="text-[10px] text-gray-400 hover:text-white inline-flex items-center gap-0.5">
                        <Download size={9} /> save
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
