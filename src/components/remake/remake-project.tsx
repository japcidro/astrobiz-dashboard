"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Link2, Loader2, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import type { BoardView } from "@/lib/marketing-board/types";
import { STILL_CREDITS, clipEstimate, getClipEngine } from "@/lib/remake/engines";
import type { BrandKit, ProjectView, ShotView } from "@/lib/remake/types";
import { Button, ConfirmButton, Pill, api, credits } from "@/components/hook-studio/ui";
import { CastBrandPanel } from "./cast-brand-panel";
import { ShotPanel } from "./shot-panel";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function shotBusy(s: ShotView) {
  return [s.still_status, s.audio_status, s.clip_status].some((x) => x === "queued" || x === "running");
}

/** The workspace for one remake: shots on the left, the chosen shot in the middle, cast and brand on the right. */
export function RemakeProject({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);

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

  const working = !!project && (project.status === "splitting" || project.status === "classifying" || project.shots.some(shotBusy) || project.shots.some((s) => s.brand_check?.notes === "Checking…"));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 6_000 : 45_000);
    return () => clearInterval(t);
  }, [working, refresh]);

  useEffect(() => {
    if (project && !selected && project.shots.length) setSelected(project.shots[0].id);
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
  const action = (shotId: string, a: "still" | "voice" | "clip") => call(a, () => api(`/api/owner/remake/projects/${id}/shots/${shotId}/${a}`, { method: "POST" }));

  const renderAll = async () => {
    if (!project) return;
    const ready = project.shots.filter((s) => s.selected && s.approved && s.still_status === "done" && s.clip_status !== "done" && !shotBusy(s) && (getClipEngine(s.clip_engine)?.mode !== "speak" || s.audio_status === "done"));
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
      router.push("/owner/remake-studio");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const shot = project?.shots.find((s) => s.id === selected) ?? null;
  const voices = worker?.voices ?? [];

  const totals = useMemo(() => {
    if (!project) return { planned: 0, spent: 0, clips: 0, selected: 0 };
    let planned = 0;
    let spent = 0;
    for (const s of project.shots) {
      if (!s.selected) continue;
      if (s.still_status !== "done") planned += STILL_CREDITS;
      if (s.clip_status === "done") spent += Number(s.clip_credits ?? 0);
      else planned += clipEstimate(s.clip_engine, s.clip_quality, Number(s.audio_seconds ?? s.seconds));
    }
    return { planned: Math.round(planned), spent: Math.round(spent * 10) / 10, clips: project.shots.filter((s) => s.clip_status === "done").length, selected: project.shots.filter((s) => s.selected).length };
  }, [project]);

  if (!project) {
    return (
      <div className="max-w-6xl">
        <Link href="/owner/remake-studio" className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Remake Studio
        </Link>
        {error ? <p className="mt-6 text-sm text-red-300">{error}</p> : <Loader2 size={20} className="mt-10 mx-auto animate-spin text-gray-500" />}
      </div>
    );
  }

  const done = project.shots.filter((s) => s.clip_status === "done" && s.clip_url);

  return (
    <div className="max-w-7xl">
      <Link href="/owner/remake-studio" className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Remake Studio
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
            {project.source_duration && <span>{fmt(Number(project.source_duration))} reference</span>}
            <span>· {project.shots.length} shots, {totals.selected} to remake</span>
            {project.board_item_title && <span>· from board card “{project.board_item_title}”</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {project.status === "splitting" && <Pill tone="run"><Loader2 size={11} className="animate-spin" /> Cutting into shots</Pill>}
          {project.status === "classifying" && <Pill tone="run"><Loader2 size={11} className="animate-spin" /> Labelling shots</Pill>}
          {project.status === "failed" && <Pill tone="bad"><AlertTriangle size={11} /> {project.error ?? "Failed"}</Pill>}
          <Pill tone="muted">{credits(totals.spent)} spent · ≈ {credits(totals.planned)} planned</Pill>
          {worker && !worker.online && <Pill tone="bad">Mac worker offline</Pill>}
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-300 bg-red-900/30 border border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

      {project.status === "splitting" || (project.status === "failed" && project.shots.length === 0) ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-800 p-10 text-center text-sm text-gray-400">
          {project.status === "failed" ? project.error : "The Mac is cutting the reference into shots. This takes about a minute."}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-4">
          <aside className="space-y-1.5">
            {project.shots.map((s) => {
              const thumb = s.still_url ?? s.frame_url;
              const bad = s.brand_check && !s.brand_check.ok && s.brand_check.notes !== "Checking…";
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={`w-full flex items-center gap-2 rounded-lg border p-1.5 text-left cursor-pointer ${s.id === selected ? "border-purple-500 bg-purple-500/10" : "border-gray-800 bg-gray-900/40 hover:bg-gray-800/60"} ${s.selected ? "" : "opacity-60"}`}
                >
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
                    <p className="text-[10px] text-gray-500 truncate">{s.kind === "talking_head" ? "Talking head" : "B-roll"}{s.brand_heavy ? " · brand-heavy" : ""}</p>
                  </div>
                  <span className="shrink-0 text-gray-500">
                    {shotBusy(s) ? <Loader2 size={12} className="animate-spin" /> : s.clip_status === "done" ? <Check size={12} className="text-green-400" /> : bad ? <AlertTriangle size={12} className="text-red-300" /> : s.approved ? <Check size={12} className="text-gray-400" /> : null}
                  </span>
                </button>
              );
            })}
          </aside>

          <main className="min-w-0">
            {shot ? (
              <ShotPanel
                key={shot.id}
                project={project}
                shot={shot}
                voices={voices}
                busy={busy}
                onPatch={(b) => patchShot(shot.id, b)}
                onAction={(a) => action(shot.id, a)}
                onProjectPatch={patchProject}
              />
            ) : (
              <p className="text-sm text-gray-500">Pick a shot.</p>
            )}
          </main>

          <CastBrandPanel
            key={project.store ?? ""}
            project={project}
            stores={stores}
            onPatch={patchProject}
            onKit={(kit: BrandKit) => setProject((p) => (p ? { ...p, brand_kit: kit } : p))}
            onError={setError}
          />
        </div>
      )}

      {project.shots.length > 0 && (
        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-white flex-1">
              Clips tray <span className="text-gray-500 font-normal">· {done.length} of {totals.selected} in reference order</span>
            </h2>
            <Button onClick={renderAll} disabled={busy !== null}>
              <Video size={13} /> Render all approved
            </Button>
            {project.board_item_id && (
              <Button onClick={attach} busy={busy === "attach"} disabled={done.length === 0}>
                <Link2 size={13} /> Attach to board card
              </Button>
            )}
            <ConfirmButton onConfirm={remove} question="Delete this remake and its files?" className="text-xs text-gray-400 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer px-2">
              <Trash2 size={12} /> Delete
            </ConfirmButton>
          </div>
          {attachMsg && <p className="text-xs text-green-400 mt-2">{attachMsg}</p>}
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {project.shots
              .filter((s) => s.selected)
              .map((s) => (
                <div key={s.id} className="text-center">
                  {s.clip_url ? (
                    <video src={s.clip_url} muted playsInline preload="metadata" onClick={() => setSelected(s.id)} className="aspect-[9/16] w-full rounded-lg bg-black border border-gray-800 cursor-pointer" />
                  ) : (
                    <button type="button" onClick={() => setSelected(s.id)} className={`aspect-[9/16] w-full rounded-lg border ${s.clip_status === "failed" ? "border-red-800/60" : "border-dashed border-gray-700"} bg-gray-950 flex items-center justify-center text-gray-600 cursor-pointer`}>
                      {shotBusy(s) ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[10px]">{s.idx + 1}</span>}
                    </button>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1 truncate">
                    {s.clip_status === "done" ? `${s.seconds}s` : s.clip_status === "failed" ? "failed" : shotBusy(s) ? "working" : s.approved ? "approved" : s.still_status === "done" ? "review still" : "no still"}
                  </p>
                  {s.clip_url && (
                    <a href={s.clip_url} download className="text-[10px] text-gray-400 hover:text-white inline-flex items-center gap-0.5">
                      <Download size={9} /> save
                    </a>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
