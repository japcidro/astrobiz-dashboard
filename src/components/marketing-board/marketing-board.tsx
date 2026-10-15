"use client";

import { AlertTriangle, Check, Images, Link as LinkIcon, Loader2, Plus, Upload, Video, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import {
  type ItemKind,
  BOARD_STATUSES,
  STATUS_LABEL,
  type BoardItem,
  type BoardStatus,
  type BoardView,
} from "@/lib/marketing-board/types";
import { Button, Pill, api } from "@/components/hook-studio/ui";
import { BoardCard } from "./board-card";
import { ItemDetail } from "./item-detail";

const DONE_PREVIEW = 12;
const WEEK_MS = 7 * 86400_000;

/**
 * The Marketing Board: paste a reference link, it becomes a card in "To do"
 * with a saved high-quality copy; assign it, write the instructions, and
 * the marketer moves it across to "Done" with the finished ad attached.
 */
export function MarketingBoard() {
  const [view, setView] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterPerson, setFilterPerson] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardStatus | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const tab: ItemKind = params.get("tab") === "images" ? "image" : "video";
  const setTab = (k: ItemKind) => router.replace(k === "image" ? "/owner/marketing-board?tab=images" : "/owner/marketing-board");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setView(await api<BoardView>("/api/owner/marketing-board"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the board");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Saving a copy happens on the Mac; poll faster while any card waits for it.
  const busy = view?.items.some((i) => i.video_status === "pending" || i.video_status === "saving") ?? false;
  useEffect(() => {
    const t = setInterval(() => void refresh(), busy ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  useEffect(() => {
    const load = () => api<WorkerStatus>("/api/owner/hook-studio/status").then(setWorker).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const replaceItem = (item: BoardItem) =>
    setView((v) => (v ? { ...v, items: v.items.some((i) => i.id === item.id) ? v.items.map((i) => (i.id === item.id ? item : i)) : [item, ...v.items] } : v));

  const add = async () => {
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const r = await api<{ item: BoardItem }>("/api/owner/marketing-board", { method: "POST", body: JSON.stringify({ url, kind: tab }) });
      replaceItem(r.item);
      setSelectedId(r.item.id);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the link");
    } finally {
      setAdding(false);
    }
  };

  const move = async (id: string, status: BoardStatus) => {
    const current = view?.items.find((i) => i.id === id);
    if (!current || current.status === status) return;
    replaceItem({ ...current, status, done_at: status === "done" ? new Date().toISOString() : null });
    try {
      const r = await api<{ item: BoardItem }>(`/api/owner/marketing-board/items/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      replaceItem(r.item);
    } catch (e) {
      replaceItem(current);
      setError(e instanceof Error ? e.message : "Could not move the card");
    }
  };

  const items = useMemo(() => view?.items ?? [], [view]);
  const filtered = useMemo(
    () =>
      items.filter(
        (i) => (i.kind ?? "video") === tab && (!filterPerson || i.assignee_id === filterPerson) && (!filterStore || i.store === filterStore)
      ),
    [items, tab, filterPerson, filterStore]
  );
  const counts = useMemo(() => ({ video: items.filter((i) => (i.kind ?? "video") === "video").length, image: items.filter((i) => i.kind === "image").length }), [items]);

  /** Upload image references straight to the bucket, then make a card for each. */
  const uploadImages = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => ["image/png", "image/jpeg", "image/webp"].includes(f.type));
    if (files.length === 0) {
      setError("Drop PNG, JPG or WebP images");
      return;
    }
    setError(null);
    setUploading({ done: 0, total: files.length });
    const supabase = createClient();
    const made: BoardItem[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/marketing-board/upload-url", { method: "POST", body: JSON.stringify({ kind: "image", mime: file.type }) });
        const up = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        const r = await api<{ item: BoardItem }>("/api/owner/marketing-board", { method: "POST", body: JSON.stringify({ upload_path: path, name: file.name.replace(/\.[a-z0-9]+$/i, ""), store: filterStore || undefined }) });
        made.push(r.item);
      } catch (e) {
        failed += 1;
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
      }
    }
    if (made.length) setView((v) => (v ? { ...v, items: [...made, ...v.items] } : v));
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (failed && made.length) setError(`${failed} of ${files.length} failed`);
  };
  const columns = useMemo(() => {
    const by: Record<BoardStatus, BoardItem[]> = { todo: [], in_progress: [], done: [] };
    for (const i of filtered) by[i.status].push(i);
    by.done.sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at));
    return by;
  }, [filtered]);

  const { doneThisWeek, open } = useMemo(() => {
    const weekAgo = Date.now() - WEEK_MS;
    return {
      doneThisWeek: items.filter((i) => i.status === "done" && i.done_at && new Date(i.done_at).getTime() > weekAgo).length,
      open: items.filter((i) => i.status !== "done").length,
    };
  }, [items]);
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const storesInUse = useMemo(() => {
    const s = new Set<string>(view?.stores ?? []);
    for (const i of items) if (i.store) s.add(i.store);
    return Array.from(s).sort();
  }, [items, view?.stores]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Marketing Board</h1>
            <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-800 p-0.5" role="tablist" aria-label="Videos or images">
              {(["video", "image"] as ItemKind[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => tab !== k && setTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${tab === k ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
                  {k === "video" ? <Video size={12} /> : <Images size={12} />} {k === "video" ? "Videos" : "Images"} · {counts[k]}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-1">{tab === "video" ? "Reference ads to copy, who makes them, and what came out." : "Image references for page posts and image ads; Make ours turns one into our own."}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="ok">
            <Check size={11} /> {doneThisWeek} done this week
          </Pill>
          <Pill tone="muted">{open} open</Pill>
          {worker && (
            worker.online ? (
              worker.ytdlp ? (
                <Pill tone="ok">
                  <Wifi size={11} /> Mac worker online
                </Pill>
              ) : (
                <Pill tone="warn">
                  <AlertTriangle size={11} /> yt-dlp missing on the Mac
                </Pill>
              )
            ) : (
              <Pill tone="bad">
                <WifiOff size={11} /> Mac worker offline
              </Pill>
            )
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="mt-6 flex gap-2 flex-wrap"
      >
        <div className="flex-1 min-w-64 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 focus-within:border-purple-500">
          <LinkIcon size={14} className="text-gray-500 shrink-0" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={tab === "video" ? "Paste a TikTok, Ads Library, Facebook, Instagram or YouTube link…" : "Paste a Facebook post, Instagram post, Ads Library image ad or image link…"}
            className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none"
          />
        </div>
        <Button primary type="submit" busy={adding} disabled={!url.trim()}>
          <Plus size={14} /> Add reference
        </Button>
        {tab === "image" && (
          <>
            <Button onClick={() => fileRef.current?.click()} busy={uploading !== null} disabled={uploading !== null} title="Add image references from your files (or drop them on the To do column)">
              <Upload size={14} /> {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : "Upload images"}
            </Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => e.target.files?.length && void uploadImages(e.target.files)} />
          </>
        )}
      </form>

      <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
        <select value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-300 focus:outline-none">
          <option value="">Everyone</option>
          {view?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-300 focus:outline-none">
          <option value="">All stores</option>
          {storesInUse.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {error && <span className="text-red-300">{error}</span>}
      </div>

      {!view && !error && (
        <div className="mt-10 flex justify-center">
          <Loader2 size={20} className="animate-spin text-gray-500" />
        </div>
      )}

      {view && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          {BOARD_STATUSES.map((status) => {
            const list = columns[status];
            const shown = status === "done" && !showAllDone ? list.slice(0, DONE_PREVIEW) : list;
            const over = dropTarget === status && dragId !== null;
            return (
              <section
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== status) setDropTarget(status);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setDropTarget(null);
                  setDragId(null);
                  if (id) void move(id, status);
                  else if (tab === "image" && status === "todo" && e.dataTransfer.files?.length) {
                    dragDepth.current = 0;
                    setFilesOver(false);
                    void uploadImages(e.dataTransfer.files);
                  }
                }}
                onDragEnter={(e: DragEvent) => {
                  if (tab !== "image" || status !== "todo" || !Array.from(e.dataTransfer.types).includes("Files")) return;
                  dragDepth.current += 1;
                  setFilesOver(true);
                }}
                onDragLeave={(e: DragEvent) => {
                  if (dropTarget === status) setDropTarget(null);
                  if (tab !== "image" || status !== "todo" || !Array.from(e.dataTransfer.types).includes("Files")) return;
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (dragDepth.current === 0) setFilesOver(false);
                }}
                className={`rounded-xl border p-2.5 min-h-[160px] transition-colors ${
                  over || (filesOver && status === "todo") ? "border-purple-500 bg-purple-500/5" : "border-gray-800 bg-gray-900/40"
                }`}
              >
                <header className="flex items-center justify-between px-1 pb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{STATUS_LABEL[status]}</h2>
                  <span className="text-xs text-gray-600">{list.length}</span>
                </header>
                <div className="space-y-2">
                  {shown.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      onSelect={() => setSelectedId(item.id)}
                      onDragStart={() => setDragId(item.id)}
                    />
                  ))}
                  {shown.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-6">
                      {status === "todo" ? (tab === "image" ? "Paste a link above, or drop images here." : "Paste a link above to start.") : "Drag a card here."}
                    </p>
                  )}
                  {tab === "image" && status === "todo" && shown.length > 0 && (
                    <p className={`text-[11px] text-center py-2 rounded-lg border border-dashed ${filesOver ? "border-purple-500 text-purple-200" : "border-gray-800 text-gray-600"}`}>Drop images here to add them</p>
                  )}
                  {status === "done" && list.length > DONE_PREVIEW && (
                    <button type="button" onClick={() => setShowAllDone((v) => !v)} className="w-full text-xs text-gray-400 hover:text-white py-2 cursor-pointer">
                      {showAllDone ? "Show fewer" : `Show all ${list.length}`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selected && view && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:bg-black/30" onClick={() => setSelectedId(null)} />
          <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-[520px] bg-gray-950 border-l border-gray-800 shadow-2xl">
            <ItemDetail
              item={selected}
              people={view.people}
              stores={storesInUse}
              onChange={replaceItem}
              onDeleted={(id) => {
                setView((v) => (v ? { ...v, items: v.items.filter((i) => i.id !== id) } : v));
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        </>
      )}
    </div>
  );
}
