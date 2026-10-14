"use client";

import { AlertTriangle, Check, Link as LinkIcon, Loader2, Plus, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import {
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
      const r = await api<{ item: BoardItem }>("/api/owner/marketing-board", { method: "POST", body: JSON.stringify({ url }) });
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
        (i) => (!filterPerson || i.assignee_id === filterPerson) && (!filterStore || i.store === filterStore)
      ),
    [items, filterPerson, filterStore]
  );
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
          <h1 className="text-2xl font-bold text-white">Marketing Board</h1>
          <p className="text-sm text-gray-500 mt-1">Reference ads to copy, who makes them, and what came out.</p>
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
        className="mt-6 flex gap-2"
      >
        <div className="flex-1 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 focus-within:border-purple-500">
          <LinkIcon size={14} className="text-gray-500 shrink-0" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a TikTok, Ads Library, Facebook, Instagram or YouTube link…"
            className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none"
          />
        </div>
        <Button primary type="submit" busy={adding} disabled={!url.trim()}>
          <Plus size={14} /> Add reference
        </Button>
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
                onDragLeave={() => dropTarget === status && setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setDropTarget(null);
                  setDragId(null);
                  if (id) void move(id, status);
                }}
                className={`rounded-xl border p-2.5 min-h-[160px] transition-colors ${
                  over ? "border-purple-500 bg-purple-500/5" : "border-gray-800 bg-gray-900/40"
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
                      {status === "todo" ? "Paste a link above to start." : "Drag a card here."}
                    </p>
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
