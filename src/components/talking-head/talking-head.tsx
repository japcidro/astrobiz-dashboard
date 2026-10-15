"use client";

import { AlertTriangle, Check, Download, Loader2, Mic, RotateCcw, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Quality } from "@/lib/hook-studio/engines";
import { CLIP_ENGINES, clipEstimate, getClipEngine } from "@/lib/remake/engines";
import { DEFAULT_VOICE_PROFILE } from "@/lib/remake/prompts";
import type { VoiceGender } from "@/lib/remake/types";
import type { StartingImage, TalkingHeadEngine, TalkingHeadPage, TalkingHeadView } from "@/lib/talking-head/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo, Lightbox } from "@/components/remake/clip-video";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

const elapsedMin = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "under a minute" : `${m} min`;
};

interface Form {
  script: string;
  direction: string;
  gender: VoiceGender | null;
  profile: string;
  engine: TalkingHeadEngine;
  quality: Quality;
  seconds: 4 | 6 | 8;
}

const EMPTY: Form = { script: "", direction: "", gender: null, profile: "", engine: "veo3_1", quality: "standard", seconds: 8 };

/**
 * Talking Head: every still the Clipper generated is a starting image here.
 * Pick one, write the script, Veo speaks it. Renders queue on the Mac worker
 * and run side by side on Higgsfield; the list below fills in as they land.
 */
export function TalkingHeadStudio() {
  const [page, setPage] = useState<TalkingHeadPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState<"render" | "delete" | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [zoom, setZoom] = useState<{ video?: string; image?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPage(await api<TalkingHeadPage>("/api/owner/talking-head"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const working = !!page?.renders.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const stills = useMemo(() => page?.stills ?? [], [page]);
  const renders = useMemo(() => page?.renders ?? [], [page]);
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of stills) if (!seen.has(s.project_id)) seen.set(s.project_id, s.project_title);
    return Array.from(seen, ([id, title]) => ({ id, title }));
  }, [stills]);
  const shown = projectFilter === "all" ? stills : stills.filter((s) => s.project_id === projectFilter);
  const still = stills.find((s) => s.shot_id === chosen) ?? null;
  const engine = getClipEngine(form.engine) ?? CLIP_ENGINES[0];
  const seconds = form.engine === "veo3" ? 8 : form.seconds;
  const estimate = clipEstimate(form.engine, form.quality, seconds);
  const inFlight = renders.filter((r) => r.status === "queued" || r.status === "running");

  const pick = (s: StartingImage) => {
    setChosen(s.shot_id);
    setForm((f) => ({ ...f, gender: s.voice_gender ?? f.gender, profile: f.profile.trim() ? f.profile : s.voice_profile }));
  };

  const render = async () => {
    if (!still) return;
    setBusy("render");
    setError(null);
    try {
      const r = await api<{ id: string; renders: TalkingHeadView[] }>("/api/owner/talking-head", {
        method: "POST",
        body: JSON.stringify({ shot_id: still.shot_id, script: form.script, voice_direction: form.direction, voice_gender: form.gender, voice_profile: form.profile, engine: form.engine, quality: form.quality, seconds }),
      });
      setPage((p) => (p ? { ...p, renders: r.renders } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the render");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy("delete");
    try {
      const r = await api<{ renders: TalkingHeadView[] }>(`/api/owner/talking-head/${id}`, { method: "DELETE" });
      setPage((p) => (p ? { ...p, renders: r.renders } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  /** Load a past render's still and settings back into the form, to redo it or vary it. */
  const reuse = (r: TalkingHeadView) => {
    if (r.source_shot_id && stills.some((s) => s.shot_id === r.source_shot_id)) setChosen(r.source_shot_id);
    setForm({ script: r.script, direction: r.voice_direction, gender: r.voice_gender, profile: r.voice_profile, engine: r.engine, quality: r.quality, seconds: r.seconds });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox video={zoom.video} image={zoom.image} onClose={() => setZoom(null)} />}
      <div>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <Mic size={22} className="text-purple-400" /> Talking Head
        </h1>
        <p className="text-sm text-gray-500 mt-1">Pick a still the Clipper made, write what the person says, and Veo speaks it. Renders run side by side; queue as many as you like and come back.</p>
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {inFlight.length > 0 && (
        <Panel>
          <Label>Rendering now · {inFlight.length} on Higgsfield</Label>
          <div className="flex flex-wrap gap-2">
            {inFlight.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs">
                <span className={`w-2 h-2 rounded-full ${r.status === "running" ? "bg-purple-400 shadow-[0_0_0_3px_rgba(168,85,247,.25)]" : "bg-gray-600"}`} />
                {r.still_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.still_url} alt="" className="w-6 aspect-[9/16] object-cover rounded" />
                )}
                <div>
                  <p className="text-white font-semibold">{r.title}</p>
                  <p className="text-gray-500">{r.status === "running" ? `${getClipEngine(r.engine)?.name ?? r.engine} · ${elapsedMin(r.updated_at)} · usually ${getClipEngine(r.engine)?.typicalMinutes ?? "10–20"} min` : "Queued on the Mac"}</p>
                </div>
              </div>
            ))}
            <span className="ml-auto self-center text-[11px] text-gray-600">You can leave this page; the Mac keeps going.</span>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <Panel>
          <div className="flex items-center gap-3 mb-3">
            <Label>Starting images · from the Clipper</Label>
            {projects.length > 1 && (
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="ml-auto bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none">
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {page === null ? (
            <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
          ) : shown.length === 0 ? (
            <p className="text-sm text-gray-500 text-center my-10">No stills yet. Every still you generate in the Clipper shows up here.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3">
              {shown.map((s) => {
                const on = chosen === s.shot_id;
                return (
                  <button key={s.shot_id} type="button" onClick={() => pick(s)} className={`text-left rounded-xl p-1 transition-colors cursor-pointer ${on ? "bg-purple-600/30 ring-2 ring-purple-500" : "hover:bg-white/5"}`}>
                    <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 bg-purple-600 text-white rounded-full p-1">
                          <Check size={12} />
                        </span>
                      )}
                      {s.voice_gender && <span className="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1 rounded capitalize">{s.voice_gender}</span>}
                    </div>
                    <p className="text-[11px] text-gray-300 mt-1.5 truncate" title={s.project_title}>
                      {s.project_title}
                    </p>
                    <p className="text-[10px] text-gray-600">
                      clip {s.clip_idx + 1} · {timeAgo(s.created_at)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel className="space-y-3 lg:sticky lg:top-4">
          <Label>New talking head</Label>
          <div className="flex gap-3">
            {still ? (
              <button type="button" onClick={() => setZoom({ image: still.url })} className="shrink-0 cursor-zoom-in" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={still.preview_url} alt="" className="w-20 aspect-[9/16] object-cover rounded-lg border border-purple-500" />
              </button>
            ) : (
              <div className="shrink-0 w-20 aspect-[9/16] rounded-lg border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-600 text-center p-1">Pick a still</div>
            )}
            <div className="flex-1 min-w-0 text-xs text-gray-400">
              {still ? (
                <>
                  <p className="text-white font-semibold truncate">{still.project_title}</p>
                  <p>clip {still.clip_idx + 1}</p>
                  <p className="mt-2 text-gray-500">The person in this still speaks the script. Voice and lips come from Veo.</p>
                </>
              ) : (
                <p>Click a starting image on the left.</p>
              )}
            </div>
          </div>

          <textarea value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} rows={4} placeholder="What the person says, English or Taglish. One or two sentences for 8 seconds." className={`${field} resize-none`} />
          <input value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} placeholder="Voice direction, e.g. warm, casual, slight smile" className={field} />
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-gray-400">Voice</span>
            <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
              {(["male", "female"] as VoiceGender[]).map((g) => (
                <button key={g} type="button" onClick={() => setForm({ ...form, gender: g })} className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize cursor-pointer ${form.gender === g ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                  {g}
                </button>
              ))}
            </div>
            <span className={form.gender ? "text-gray-600" : "text-amber-300"}>{form.gender ? "From the still's brand check; change it if wrong." : "Pick one so Veo uses the right voice."}</span>
          </div>
          <textarea value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} rows={3} placeholder={DEFAULT_VOICE_PROFILE} className={`${field} resize-none text-xs`} title="Who the voice is. Empty = the Taglish default. Keep it the same across renders so they sound alike." />

          <div className="flex flex-wrap gap-1.5">
            {CLIP_ENGINES.filter((e) => e.mode === "speak").map((e) => (
              <button key={e.id} type="button" onClick={() => setForm({ ...form, engine: e.id as TalkingHeadEngine })} className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${form.engine === e.id ? "border-purple-500 bg-purple-500/15 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
                {e.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {engine.qualityLabels && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {(["standard", "high"] as Quality[]).map((q) => (
                  <button key={q} type="button" onClick={() => setForm({ ...form, quality: q })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${form.quality === q ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {engine.qualityLabels![q]}
                  </button>
                ))}
              </div>
            )}
            {engine.lengths && engine.lengths.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {engine.lengths.map((n) => (
                  <button key={n} type="button" onClick={() => setForm({ ...form, seconds: n as 4 | 6 | 8 })} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${seconds === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}s
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500">{engine.blurb}</p>

          <div className="flex items-center gap-3 flex-wrap">
            <Button primary onClick={() => void render()} busy={busy === "render"} disabled={!still || !form.script.trim() || busy !== null}>
              <Video size={13} /> Render
            </Button>
            <span className="text-xs text-gray-400">
              ≈ {credits(estimate)} · {seconds}s · usually {engine.typicalMinutes} min
            </span>
          </div>
          <p className="text-[11px] text-gray-600">Render as many as you want in a row; each one queues and runs on its own.</p>
        </Panel>
      </div>

      <Panel>
        <Label>Renders · {renders.length}</Label>
        {renders.length === 0 ? (
          <p className="text-sm text-gray-500 text-center my-8">Nothing rendered yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {renders.map((r) => {
              const running = r.status === "queued" || r.status === "running";
              return (
                <div key={r.id} className="rounded-xl border border-gray-800 bg-gray-950 p-2 flex flex-col gap-1.5">
                  <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
                    {r.clip_url ? (
                      <ClipVideo src={r.clip_url} poster={r.still_url} className="h-full" />
                    ) : (
                      <>
                        {r.still_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.still_url} alt="" className={`w-full h-full object-cover ${running ? "opacity-50" : "opacity-40"}`} />
                        )}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center p-2">
                          {running ? <Loader2 size={18} className="animate-spin text-purple-300" /> : <AlertTriangle size={18} className="text-red-300" />}
                          <p className="text-[11px] text-white">{r.status === "running" ? `Veo · ${elapsedMin(r.updated_at)}` : r.status === "queued" ? "Queued on the Mac" : "Failed"}</p>
                          {r.status === "failed" && r.error && <p className="text-[10px] text-red-300 line-clamp-3">{r.error}</p>}
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-white font-semibold truncate" title={r.title}>
                    {r.title}
                  </p>
                  <p className="text-[11px] text-gray-400 line-clamp-2" title={r.script}>
                    {r.script}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Pill tone={r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "run"}>{r.status === "done" ? `${getClipEngine(r.engine)?.name ?? r.engine} · ${r.seconds}s` : r.status}</Pill>
                    {r.voice_gender && <Pill tone="muted">{r.voice_gender}</Pill>}
                    <span className="text-[10px] text-gray-600">{timeAgo(r.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] mt-auto">
                    {r.clip_url && (
                      <a href={r.clip_url} download className="text-gray-300 hover:text-white inline-flex items-center gap-1">
                        <Download size={11} /> Download
                      </a>
                    )}
                    <button type="button" onClick={() => reuse(r)} className="text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Load this still and script back into the form">
                      <RotateCcw size={11} /> Reuse
                    </button>
                    <ConfirmButton question="Delete?" label="Delete" onConfirm={() => void remove(r.id)} className="ml-auto text-gray-500 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer">
                      <Trash2 size={11} />
                    </ConfirmButton>
                  </div>
                  {r.credits != null && r.status === "done" && <p className="text-[10px] text-gray-600">This render cost {credits(r.credits)}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
