"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Trash2, Clapperboard, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { UGC_CREDITS_PER_IMAGE, UGC_MAX_PER_BATCH } from "@/lib/hook-studio/engines";
import { LOOKS, DEFAULT_LOOK, type LookId } from "@/lib/hook-studio/presets";
import type { UgcView, WorkerStatus } from "@/lib/hook-studio/types";
import { Panel, Label, Chip, Button, Pill, credits, timeAgo, api } from "./ui";

// The library refreshes itself: every 3 s while anything is rendering,
// every 10 s otherwise, so a finished image appears without a reload.
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 10000;
const STATUS_POLL_MS = 15000;

interface Picked {
  file: File;
  url: string;
  width: number;
  height: number;
}

export function UgcGenerator() {
  const [items, setItems] = useState<UgcView[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [note, setNote] = useState("");
  const [look, setLook] = useState<LookId>(DEFAULT_LOOK);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api<{ items: UgcView[] }>("/api/owner/hook-studio/ugc")
        .then((r) => setItems(r.items))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the library")),
    []
  );
  const loadWorker = useCallback(
    () =>
      api<WorkerStatus>("/api/owner/hook-studio/status")
        .then(setWorker)
        .catch(() => {}),
    []
  );

  useEffect(() => {
    void load();
    void loadWorker();
    const t = setInterval(() => void loadWorker(), STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [load, loadWorker]);

  const pending = useMemo(() => items.some((i) => i.status === "queued" || i.status === "running"), [items]);
  useEffect(() => {
    const t = setInterval(() => void load(), pending ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(t);
  }, [load, pending]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error("Drop a PNG, JPG or WebP");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setPicked({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => toast.error("That image could not be read");
    img.src = url;
  };

  const generate = async () => {
    if (!picked) return;
    try {
      setBusy("Uploading…");
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>(
        "/api/owner/hook-studio/upload-url",
        { method: "POST", body: JSON.stringify({ kind: "ugc", mime: picked.file.type }) }
      );
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, picked.file, { contentType: picked.file.type });
      if (up.error) throw new Error(up.error.message);
      setBusy("Queuing…");
      const r = await api<{ items: UgcView[] }>("/api/owner/hook-studio/ugc", {
        method: "POST",
        body: JSON.stringify({ source_path: path, note, look, count }),
      });
      setItems(r.items);
      setPicked(null);
      setNote("");
      toast.success(worker?.online ? `${count} image${count > 1 ? "s" : ""} queued` : "Queued. It runs when the Mac is online.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue");
    } finally {
      setBusy(null);
    }
  };

  const again = async (item: UgcView) => {
    try {
      const r = await api<{ items: UgcView[] }>("/api/owner/hook-studio/ugc", {
        method: "POST",
        body: JSON.stringify({ source_path: item.source_path, note: item.note, look, count: 1 }),
      });
      setItems(r.items);
      toast.success("One more queued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue");
    }
  };

  const remove = async (item: UgcView) => {
    try {
      const r = await api<{ items: UgcView[] }>(`/api/owner/hook-studio/ugc/${item.id}`, { method: "DELETE" });
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const portrait = picked ? picked.height > picked.width : true;
  const total = UGC_CREDITS_PER_IMAGE * count;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ImagePlus size={22} className="text-purple-300" /> UGC Generator
          </h1>
          <p className="text-sm text-gray-500 mt-1">Drop a UGC photo. Get the same shot back with a clearly different person in it.</p>
        </div>
        {worker &&
          (worker.online ? (
            <Pill tone="ok">Mac worker online{worker.credits !== null ? ` · ${credits(worker.credits)}` : ""}</Pill>
          ) : (
            <Pill tone="warn">Mac worker offline{worker.last_seen ? ` · last seen ${timeAgo(worker.last_seen)}` : ""}</Pill>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        <Panel>
          <Label>Source photo</Label>
          {!picked ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                dragging ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <ImagePlus size={26} className="mx-auto text-gray-500" />
              <p className="text-sm text-gray-300 mt-3 font-medium">Drop a UGC frame, or click to choose</p>
              <p className="text-xs text-gray-500 mt-1">PNG, JPG or WebP. Portrait works best; the output is always 9:16.</p>
              <input ref={inputRef} id="ugc-source-file" type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          ) : (
            <div className="grid grid-cols-[150px_1fr] gap-4 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={picked.url} alt="source" className="w-full aspect-[9/16] object-cover rounded-xl border border-gray-700 bg-black" />
              <div className="text-sm">
                <p className="text-gray-200 truncate">{picked.file.name}</p>
                <p className="text-gray-500 text-xs mt-1">
                  {picked.width}×{picked.height}
                  {!portrait && <span className="text-orange-300"> · landscape: the output is cropped to 9:16</span>}
                </p>
                <div className="mt-3">
                  <Button ghost onClick={() => setPicked(null)}>
                    <X size={14} /> Replace
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Label>Look of the new person</Label>
          <div className="flex flex-wrap gap-2">
            {LOOKS.map((l) => (
              <Chip key={l.id} on={look === l.id} onClick={() => setLook(l.id)}>
                {l.label}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Varied gives each image in a batch a different person from a US mix. Always: a new face, attractive and fit, same gender, straight or softly wavy hair. Every caption, icon and app control is removed so the output is a clean photo. Pose, clothing, framing and background stay.
          </p>

          <Label>Anything extra (optional)</Label>
          <input
            id="ugc-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "make her look older" or "short hair"'
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          <div className="flex items-center justify-between gap-3 flex-wrap mt-5 pt-4 border-t border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Variations</span>
              <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
                {Array.from({ length: UGC_MAX_PER_BATCH }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${count === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-500">{UGC_CREDITS_PER_IMAGE} cr each</span>
            </div>
            <Button primary onClick={generate} busy={!!busy} disabled={!picked}>
              {busy ?? `Generate ×${count} · ${credits(total)}`}
            </Button>
          </div>
        </Panel>

        <Panel className="self-start">
          <p className="text-sm font-semibold text-white">How this works</p>
          <ul className="text-sm text-gray-400 mt-2 space-y-2 list-disc pl-4">
            <li>Nano Banana Pro edits the photo in place: same room, same pose, same clothes, new person.</li>
            <li>Every result lands in the library below. Delete what you don&apos;t like; keep what works.</li>
            <li>Press &quot;Use in Hook Studio&quot; on a result to turn it into a silent video hook.</li>
            <li>Renders on the Mac with your creator credits, about 40 seconds each.</li>
          </ul>
        </Panel>
      </div>

      <h2 className="text-lg font-semibold text-white mt-8 mb-3">Library</h2>
      {items.length === 0 ? (
        <Panel className="text-center py-10">
          <p className="text-gray-400 text-sm">Nothing generated yet.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
              <div className="relative aspect-[9/16] bg-gray-900">
                {it.status === "done" && it.result_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL
                  <img src={it.result_url} alt="generated" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-xs text-gray-500 px-3 text-center">
                    {it.status === "queued" && "Queued for the Mac"}
                    {it.status === "running" && <span className="text-amber-300">Rendering…</span>}
                    {it.status === "failed" && <span className="text-red-300 break-words">{it.error || "Failed"}</span>}
                    {it.status === "canceled" && "Canceled"}
                  </div>
                )}
                {it.source_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL
                  <img src={it.source_url} alt="source" title="Source photo" className="absolute left-2 bottom-2 w-12 aspect-[9/16] object-cover rounded-md border border-white/40 shadow" />
                )}
                <button type="button" onClick={() => remove(it)} title="Delete" className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-gray-300 hover:text-red-300 cursor-pointer">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="px-2.5 py-2 text-[11px] text-gray-400 flex items-center justify-between gap-2">
                <span className="truncate" title={it.look ? `Look: ${LOOKS.find((l) => l.id === it.look)?.label ?? it.look}` : undefined}>
                  {timeAgo(it.created_at)} · {credits(it.estimate_credits ?? UGC_CREDITS_PER_IMAGE)}
                  {it.look ? ` · ${LOOKS.find((l) => l.id === it.look)?.label ?? it.look}` : ""}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => again(it)} title="One more from the same photo" className="text-gray-400 hover:text-white cursor-pointer">
                    <RefreshCw size={12} />
                  </button>
                  {it.status === "done" && (
                    <Link href={`/owner/hook-studio?ugc=${it.id}`} className="text-purple-300 hover:text-white inline-flex items-center gap-1 font-semibold">
                      <Clapperboard size={12} /> Use
                    </Link>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
