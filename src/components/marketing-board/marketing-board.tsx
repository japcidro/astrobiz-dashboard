"use client";

import { AlertTriangle, Archive, Check, Images, LayoutGrid, Link as LinkIcon, Loader2, Plus, Search, Upload, Video, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import {
  type ItemKind,
  ARCHIVE_AFTER_HOURS,
  BOARD_STATUSES,
  STATUS_LABEL,
  isArchived,
  type ArchivePage,
  type BoardItem,
  type BoardStatus,
  type BoardView,
} from "@/lib/marketing-board/types";
import { Button, Pill, api } from "@/components/hook-studio/ui";
import { ArchiveView } from "./archive-view";
import { BoardCard } from "./board-card";
import { ItemDetail } from "./item-detail";
import { DropOverlay, UploadPanel, useFileDrop, useUploadQueue } from "./upload-queue";

const DONE_PREVIEW = 12;
const WEEK_MS = 7 * 86400_000;

/** Counts toward "done this week": finished in the last 7 days. */
const doneInWeek = (i: BoardItem | undefined) =>
  !!i && i.status === "done" && !!i.done_at && new Date(i.done_at).getTime() > Date.now() - WEEK_MS;

/**
 * The Marketing Board: paste a reference link, it becomes a card in "To do"
 * with a saved high-quality copy; assign it, write the instructions, and
 * the marketer moves it across to "Done" with the finished ad attached.
 * ARCHIVE_AFTER_HOURS after that it leaves the board for the Archive, which
 * keeps the history (?view=archive).
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
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: ItemKind = params.get("tab") === "images" ? "image" : "video";
  const showArchive = params.get("view") === "archive";
  const go = (k: ItemKind, archive: boolean) => {
    const qs = new URLSearchParams();
    if (k === "image") qs.set("tab", "images");
    if (archive) qs.set("view", "archive");
    const q = qs.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };
  const setTab = (k: ItemKind) => go(k, showArchive);
  const setShowArchive = (archive: boolean) => {
    if (archive === showArchive) return;
    setSelectedId(null);
    go(tab, archive);
  };
  const [archive, setArchive] = useState<ArchivePage | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveQ, setArchiveQ] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const archiveSeq = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Archive: the first page reloads when the tab, a filter or the search
  // changes, and when the board's count says more cards were archived.
  const archivedCount = view?.archived[tab] ?? 0;
  useEffect(() => {
    const t = setTimeout(() => setArchiveSearch(archiveQ.trim()), 300);
    return () => clearTimeout(t);
  }, [archiveQ]);

  const loadArchive = useCallback(
    async (offset: number) => {
      const seq = ++archiveSeq.current;
      setArchiveLoading(true);
      const qs = new URLSearchParams({ kind: tab, offset: String(offset) });
      if (filterPerson) qs.set("assignee", filterPerson);
      if (filterStore) qs.set("store", filterStore);
      if (archiveSearch) qs.set("q", archiveSearch);
      try {
        const page = await api<ArchivePage>(`/api/owner/marketing-board/archive?${qs}`);
        if (seq !== archiveSeq.current) return;
        setArchive((a) =>
          offset > 0 && a ? { items: [...a.items, ...page.items.filter((i) => !a.items.some((x) => x.id === i.id))], total: page.total } : page
        );
        setError(null);
      } catch (e) {
        if (seq === archiveSeq.current) setError(e instanceof Error ? e.message : "Could not load the archive");
      } finally {
        if (seq === archiveSeq.current) setArchiveLoading(false);
      }
    },
    [tab, filterPerson, filterStore, archiveSearch]
  );

  useEffect(() => {
    if (showArchive) void loadArchive(0);
  }, [showArchive, loadArchive, archivedCount]);

  /**
   * Put a changed card where it now belongs: on the board, or in the
   * Archive when it is a Done card older than ARCHIVE_AFTER_HOURS (an
   * archived card moved back to To do or In progress returns to the board).
   */
  const replaceItem = (item: BoardItem) => {
    const prev = view?.items.find((i) => i.id === item.id) ?? archive?.items.find((i) => i.id === item.id);
    const inArchive = archive?.items.some((i) => i.id === item.id) ?? false;
    const archivedNow = isArchived(item);
    const kind: ItemKind = item.kind ?? "video";
    const archivedDelta = (archivedNow && !inArchive ? 1 : 0) - (!archivedNow && inArchive ? 1 : 0);
    const weekDelta = Number(doneInWeek(item)) - Number(doneInWeek(prev));
    setView((v) => {
      if (!v) return v;
      const has = v.items.some((i) => i.id === item.id);
      const items = archivedNow ? v.items.filter((i) => i.id !== item.id) : has ? v.items.map((i) => (i.id === item.id ? item : i)) : [item, ...v.items];
      return {
        ...v,
        items,
        archived: archivedDelta ? { ...v.archived, [kind]: Math.max(0, v.archived[kind] + archivedDelta) } : v.archived,
        done_this_week: Math.max(0, v.done_this_week + weekDelta),
      };
    });
    setArchive((a) => {
      if (!a || !a.items.some((i) => i.id === item.id)) return a;
      return archivedNow ? { ...a, items: a.items.map((i) => (i.id === item.id ? item : i)) } : { items: a.items.filter((i) => i.id !== item.id), total: Math.max(0, a.total - 1) };
    });
  };

  const removeItem = (id: string) => {
    const gone = view?.items.find((i) => i.id === id) ?? archive?.items.find((i) => i.id === id);
    const inArchive = archive?.items.some((i) => i.id === id) ?? false;
    const kind: ItemKind = gone?.kind ?? "video";
    setView((v) =>
      v
        ? {
            ...v,
            items: v.items.filter((i) => i.id !== id),
            archived: inArchive ? { ...v.archived, [kind]: Math.max(0, v.archived[kind] - 1) } : v.archived,
            done_this_week: Math.max(0, v.done_this_week - Number(doneInWeek(gone))),
          }
        : v
    );
    setArchive((a) => (a && inArchive ? { items: a.items.filter((i) => i.id !== id), total: Math.max(0, a.total - 1) } : a));
  };

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

  // Uploads: a queue (three at a time, progress per file, retry), fed by
  // the Upload button or by dropping files anywhere on the page.
  const addUploaded = useCallback((item: BoardItem) => setView((v) => (v && !v.items.some((i) => i.id === item.id) ? { ...v, items: [item, ...v.items] } : v)), []);
  const uploads = useUploadQueue(addUploaded);
  const queueFiles = (list: FileList | File[]) => {
    const r = uploads.add(list, filterStore || undefined);
    const skipped = [r.wrongType ? `${r.wrongType} not a video or image` : "", r.tooBig ? `${r.tooBig} over 500 MB` : ""].filter(Boolean).join(", ");
    setError(skipped ? `Skipped ${skipped}` : null);
    if (r.added && showArchive) setShowArchive(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const fileDragOver = useFileDrop(queueFiles);
  const uploadingCount = uploads.rows.filter((r) => r.status === "waiting" || r.status === "uploading" || r.status === "saving").length;

  const columns = useMemo(() => {
    const by: Record<BoardStatus, BoardItem[]> = { todo: [], in_progress: [], done: [] };
    for (const i of filtered) by[i.status].push(i);
    by.done.sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at));
    return by;
  }, [filtered]);

  const doneThisWeek = view?.done_this_week ?? 0;
  const open = useMemo(() => items.filter((i) => i.status !== "done").length, [items]);
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? archive?.items.find((i) => i.id === selectedId) ?? null : null;

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

      {showArchive ? (
        <div className="mt-6 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 focus-within:border-purple-500">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            value={archiveQ}
            onChange={(e) => setArchiveQ(e.target.value)}
            placeholder={`Search archived ${tab === "video" ? "videos" : "images"} by title…`}
            className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none"
          />
          {archiveLoading && <Loader2 size={14} className="animate-spin text-gray-500" />}
        </div>
      ) : (
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
          <Button
            onClick={() => fileRef.current?.click()}
            title={tab === "image" ? "Add image references from your files, or drop them anywhere on the page" : "Add ads you downloaded, e.g. from a spy tool whose links need its login, or drop them anywhere on the page"}
          >
            {uploadingCount > 0 ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {tab === "image" ? "Upload images" : "Upload videos"}
          </Button>
          <input
            key={tab}
            ref={fileRef}
            type="file"
            accept={tab === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"}
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && queueFiles(e.target.files)}
          />
        </form>
      )}

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
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-800 p-0.5" role="tablist" aria-label="Board or archive">
          <button type="button" role="tab" aria-selected={!showArchive} onClick={() => setShowArchive(false)} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold cursor-pointer ${!showArchive ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
            <LayoutGrid size={12} /> Board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showArchive}
            onClick={() => setShowArchive(true)}
            title={`Done cards move here ${ARCHIVE_AFTER_HOURS} hours after they are finished`}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold cursor-pointer ${showArchive ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
          >
            <Archive size={12} /> Archive · {archivedCount}
          </button>
        </div>
      </div>

      {!view && !error && (
        <div className="mt-10 flex justify-center">
          <Loader2 size={20} className="animate-spin text-gray-500" />
        </div>
      )}

      {view && showArchive && (
        <ArchiveView
          items={archive?.items ?? null}
          total={archive?.total ?? 0}
          loading={archiveLoading}
          filtered={!!(filterPerson || filterStore || archiveSearch)}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLoadMore={() => void loadArchive(archive?.items.length ?? 0)}
        />
      )}

      {view && !showArchive && (
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
                  // Files dropped from the desktop are picked up by the page-wide drop.
                  if (id) void move(id, status);
                }}
                onDragLeave={() => {
                  if (dropTarget === status) setDropTarget(null);
                }}
                className={`rounded-xl border p-2.5 min-h-[160px] transition-colors ${over ? "border-purple-500 bg-purple-500/5" : "border-gray-800 bg-gray-900/40"}`}
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
                      {status === "todo" ? `Paste a link above, or drop ${tab === "image" ? "images" : "videos"} anywhere on the page.` : "Drag a card here."}
                    </p>
                  )}
                  {status === "todo" && shown.length > 0 && (
                    <p className="text-[11px] text-center py-2 rounded-lg border border-dashed border-gray-800 text-gray-600">Drop videos or images anywhere on the page to add them, as many as you like</p>
                  )}
                  {status === "done" && list.length > DONE_PREVIEW && (
                    <button type="button" onClick={() => setShowAllDone((v) => !v)} className="w-full text-xs text-gray-400 hover:text-white py-2 cursor-pointer">
                      {showAllDone ? "Show fewer" : `Show all ${list.length}`}
                    </button>
                  )}
                  {status === "done" && (
                    <p className="text-[11px] text-gray-600 text-center pt-1">
                      Moves to the{" "}
                      <button type="button" onClick={() => setShowArchive(true)} className="text-gray-400 hover:text-white underline underline-offset-2 cursor-pointer">
                        Archive
                      </button>{" "}
                      {ARCHIVE_AFTER_HOURS} h after it is done
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <DropOverlay show={fileDragOver} />
      <UploadPanel rows={uploads.rows} onRetry={uploads.retry} onDismiss={uploads.dismiss} onClear={uploads.clear} />

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
                removeItem(id);
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
