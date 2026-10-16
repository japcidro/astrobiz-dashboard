"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Hand, Image as ImageIcon, Loader2, Pencil, RefreshCw, Sparkles, ThumbsUp, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IMAGE_MODELS, REF_ROLES, VIDEO_MODELS, beatKindName } from "@/lib/hook-generator/engines";
import type { HookgenBeatView, HookgenView, StepStatus } from "@/lib/hook-generator/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo, Lightbox } from "@/components/remake/clip-video";
import { hookProgress } from "./hook-generator-list";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const busyStep = (s: StepStatus | null) => s === "queued" || s === "running";

function StepPill({ label, status, icon }: { label: string; status: StepStatus | null; icon: React.ReactNode }) {
  const tone = status === "done" ? "ok" : status === "failed" ? "bad" : status ? "run" : "muted";
  return (
    <Pill tone={tone}>
      {status === "running" ? <Loader2 size={10} className="animate-spin" /> : status === "done" ? <Check size={10} /> : icon}
      {label}
    </Pill>
  );
}

/** One hook: approve or fix each starting image, then follow the clips, the head-tap checks and the joined hook. */
export function HookGeneratorHook({ id }: { id: string }) {
  const router = useRouter();
  const [hook, setHook] = useState<HookgenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ video?: string; image?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHook(await api<HookgenView>(`/api/owner/hook-generator/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const waiting = hook?.status === "planning" || hook?.status === "working" || (hook?.status === "stills" && hook.beats.some((b) => b.still_status !== "done"));
  useEffect(() => {
    const t = setInterval(() => void refresh(), waiting ? 5_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, waiting]);

  const act = async (key: string, fn: () => Promise<HookgenView | null | void>) => {
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

  const hookAction = (action: string) => act(action, () => api<HookgenView>(`/api/owner/hook-generator/${id}`, { method: "POST", body: JSON.stringify({ action }) }));
  const beatAction = (beatId: string, action: string, text?: string) =>
    act(`${action}:${beatId}`, () =>
      api<HookgenView>(`/api/owner/hook-generator/${id}/beats/${beatId}`, { method: "POST", body: JSON.stringify(action === "set_line" ? { action, line: text } : { action, fix: text }) })
    );

  const anotherTake = () =>
    act("take", async () => {
      await api<{ id: string }>(`/api/owner/hook-generator/${id}`, { method: "POST", body: JSON.stringify({ action: "another_take" }) });
      router.push("/owner/hook-generator");
    });

  if (!hook) {
    return (
      <div className="max-w-7xl">
        {error ? <p className="text-sm text-red-300">{error}</p> : <Loader2 size={20} className="mx-auto my-16 animate-spin text-gray-500" />}
      </div>
    );
  }

  const p = hookProgress(hook);
  const joining = hook.final_status === "queued" || hook.final_status === "running";
  const allStills = hook.beats.length > 0 && hook.beats.every((b) => b.still_status === "done");
  const allApproved = hook.beats.length > 0 && hook.beats.every((b) => b.approved);
  const video = VIDEO_MODELS.find((m) => m.id === hook.video_model)?.name ?? hook.video_model;
  const image = IMAGE_MODELS.find((m) => m.id === hook.image_model)?.name ?? hook.image_model;

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox video={zoom.video} image={zoom.image} onClose={() => setZoom(null)} />}
      <div>
        <Link href="/owner/hook-generator" className="text-xs text-gray-500 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Hook Generator
        </Link>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Hand size={20} className="text-purple-400" /> {hook.title}
          </h1>
          <Pill tone={p.tone}>{p.label}</Pill>
          <span className="text-xs text-gray-500">
            {image} · {video} · {timeAgo(hook.created_at)} · spent {credits(hook.credits)}
          </span>
          <span className="flex-1" />
          <Button onClick={() => void anotherTake()} busy={busy === "take"} disabled={busy !== null || hook.status === "planning"} title="Same references, direction and line; a new plan">
            <Sparkles size={12} /> Another take
          </Button>
          <ConfirmButton
            question="Delete this hook?"
            onConfirm={() =>
              act("delete", async () => {
                await api(`/api/owner/hook-generator/${id}`, { method: "DELETE" });
                router.push("/owner/hook-generator");
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

      {hook.status === "planning" && (
        <Panel className="flex items-center gap-3 text-sm text-gray-300">
          <Loader2 size={16} className="animate-spin text-purple-300" /> Claude is looking at your references and planning the beats. About half a minute.
        </Panel>
      )}
      {hook.status === "failed" && (
        <Panel className="flex items-center gap-3 flex-wrap text-sm">
          <AlertTriangle size={16} className="text-red-300" />
          <span className="text-red-200">{hook.error ?? "Planning failed"}</span>
          <Button onClick={() => void hookAction("replan")} busy={busy === "replan"}>
            <RefreshCw size={12} /> Plan again
          </Button>
        </Panel>
      )}
      {hook.status === "stills" && hook.beats.length > 0 && (
        <Panel className="flex items-center gap-3 flex-wrap text-sm border-amber-700/60">
          <ThumbsUp size={16} className="text-amber-300" />
          <span className="text-gray-200 flex-1 min-w-0">
            {allStills
              ? "Approve each starting image, or type what to change and redo it. When every image is approved, the Mac animates the hook by itself."
              : "The Mac is drawing the starting images. Approve each one as it lands, or type what to change and redo it."}
          </span>
          <Button primary onClick={() => void hookAction("approve_all")} busy={busy === "approve_all"} disabled={!allStills || busy !== null}>
            <Check size={13} /> Approve all and animate
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
                    {hook.final_status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className={joining || hook.status === "working" ? "animate-spin text-purple-300" : "text-gray-600"} />}
                    <p className="text-[11px] text-gray-300">
                      {hook.status === "stills" || !allApproved ? "Starts once every starting image is approved" : hook.final_status === "failed" ? hook.final_error ?? "Join failed" : p.detail}
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
                  <button type="button" onClick={() => void hookAction("rejoin")} className="ml-auto text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Join the current clips again">
                    <RefreshCw size={11} /> Rejoin
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-600">No captions on purpose: add them in CapCut. Each beat&apos;s clip can be downloaded too.</p>
            </Panel>

            {hook.refs_view.length > 0 && (
              <Panel>
                <Label>References</Label>
                <div className="grid grid-cols-3 gap-2">
                  {hook.refs_view.map((r, i) => (
                    <button key={`${r.path}-${i}`} type="button" onClick={() => r.url && setZoom({ image: r.url })} className="text-left cursor-zoom-in">
                      <div className="aspect-[3/4] rounded-md overflow-hidden bg-black">
                        {r.url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                        {i + 1}. {REF_ROLES.find((x) => x.id === r.role)?.name ?? r.role}
                      </p>
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            <Panel className="space-y-2">
              <Label>Direction</Label>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{hook.direction || "None"}</p>
              <p className="text-[11px] text-gray-500">{hook.line ? `Line: “${hook.line}”` : "Line written by Claude"}</p>
              {hook.voice && <p className="text-[11px] text-gray-500">Voice: {hook.voice}</p>}
            </Panel>
          </div>

          <Panel>
            <Label>Beats · {hook.beats.length}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {hook.beats.map((b) => (
                <BeatCard key={b.id} beat={b} hookWorking={hook.status === "working" || hook.status === "done"} busy={busy} onZoom={setZoom} onAction={(action, fix) => void beatAction(b.id, action, fix)} />
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
  hookWorking,
  busy,
  onZoom,
  onAction,
}: {
  beat: HookgenBeatView;
  hookWorking: boolean;
  busy: string | null;
  onZoom: (z: { video?: string; image?: string }) => void;
  onAction: (action: "approve" | "unapprove" | "redo_still" | "redo_clip" | "set_line", text?: string) => void;
}) {
  const [fix, setFix] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const stillBusy = busyStep(b.still_status);
  const clipBusy = busyStep(b.clip_status);
  const checkBusy = busyStep(b.check_status);
  const showClip = !!b.clip_url && !clipBusy && b.approved;
  const err = b.still_error || b.clip_error;
  const check =
    b.check_status === "done"
      ? b.check_ok
        ? { tone: "ok" as const, label: "Head tap seen" }
        : { tone: "warn" as const, label: "No head tap found" }
      : b.check_status === "failed"
        ? { tone: "muted" as const, label: "Not checked" }
        : checkBusy
          ? { tone: "run" as const, label: "Checking head tap" }
          : b.rerolls > 0 && clipBusy
            ? { tone: "run" as const, label: "No tap: making it again" }
            : null;

  return (
    <div className={`rounded-xl border bg-gray-950 p-2 flex flex-col gap-1.5 ${b.approved ? "border-green-800/70" : "border-gray-800"}`}>
      <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
        {showClip ? (
          <ClipVideo src={b.clip_url!} poster={b.still_preview_url} className="h-full" />
        ) : b.still_preview_url ? (
          <button type="button" onClick={() => onZoom({ image: b.still_url ?? b.still_preview_url! })} className="w-full h-full cursor-zoom-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.still_preview_url} alt="" className={`w-full h-full object-cover ${stillBusy ? "opacity-40" : ""}`} />
          </button>
        ) : null}
        {(stillBusy || clipBusy || (!b.still_preview_url && !b.still_status)) && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-gray-200 px-2 py-1 flex items-center gap-1.5 pointer-events-none">
            <Loader2 size={10} className="animate-spin" />
            {stillBusy ? "Drawing the starting image…" : clipBusy ? (b.clip_status === "running" ? "Animating, ~2–10 min…" : "Clip queued…") : "Waiting"}
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
          {b.idx + 1} · {beatKindName(b.kind)}
        </span>
      </div>
      {line === null ? (
        <button type="button" onClick={() => setLine(b.line)} className="text-left text-[12px] text-white leading-snug hover:text-purple-200 cursor-pointer group" title="Change what the expert says">
          {b.line ? `“${b.line}”` : <span className="text-gray-500">No words</span>} <Pencil size={10} className="inline text-gray-600 group-hover:text-purple-300" />
          <span className="text-[10px] text-gray-500"> · {Number(b.seconds).toFixed(1)}s, {b.clip_seconds}s clip</span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              onAction("set_line", line);
              setLine(null);
            }}
            className={field}
            autoFocus
          />
          <Button
            onClick={() => {
              onAction("set_line", line);
              setLine(null);
            }}
            disabled={busy !== null}
            className="!px-2 !py-1.5 !text-[11px] shrink-0"
            title={b.clip_status ? "Save; the clip is made again with the new words" : "Save the new words"}
          >
            Save
          </Button>
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <StepPill label="Image" status={b.still_status} icon={<ImageIcon size={10} />} />
        {b.approved && (
          <Pill tone="ok">
            <ThumbsUp size={10} /> Approved
          </Pill>
        )}
        {(b.clip_status || hookWorking) && <StepPill label="Clip" status={b.clip_status} icon={<Video size={10} />} />}
        {check && (
          <Pill tone={check.tone}>
            <Hand size={10} /> {check.label}
          </Pill>
        )}
      </div>
      {b.check_notes && <p className="text-[10px] text-gray-500 line-clamp-2" title={b.check_notes}>{b.check_notes}</p>}
      {err && <p className="text-[10px] text-red-300 line-clamp-3" title={err}>{err}</p>}
      {b.fix && <p className="text-[10px] text-gray-500 line-clamp-2" title={b.fix}>Last fix: {b.fix}</p>}

      <div className="mt-auto space-y-1.5 pt-1">
        {!b.approved && b.still_status === "done" && (
          <Button primary onClick={() => onAction("approve")} busy={busy === `approve:${b.id}`} disabled={busy !== null} className="w-full justify-center !py-1.5 !text-xs">
            <ThumbsUp size={12} /> Approve
          </Button>
        )}
        <div className="flex items-center gap-1.5">
          <input
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !stillBusy && onAction("redo_still", fix)}
            placeholder="What to change, e.g. make the part wider"
            className={field}
          />
          <Button onClick={() => onAction("redo_still", fix)} busy={busy === `redo_still:${b.id}`} disabled={busy !== null || stillBusy} className="!px-2 !py-1.5 !text-[11px] shrink-0" title="Draw the image again with your change (resets this beat's clip)">
            <RefreshCw size={11} /> Redo
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          {b.approved && !b.clip_status && !hookWorking && (
            <button type="button" onClick={() => onAction("unapprove")} className="text-gray-500 hover:text-white cursor-pointer">
              Take back approval
            </button>
          )}
          {b.approved && (b.clip_status === "done" || b.clip_status === "failed") && (
            <button type="button" onClick={() => onAction("redo_clip")} className="text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer" title="Animate the same image again">
              <RefreshCw size={11} /> Clip again
            </button>
          )}
          {b.clip_url && (
            <a href={b.clip_url} download className="ml-auto text-gray-400 hover:text-white" title="Download this beat's clip">
              <Download size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
