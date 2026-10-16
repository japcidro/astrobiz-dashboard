"use client";

import { Archive, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { ARCHIVE_AFTER_HOURS, type BoardItem } from "@/lib/marketing-board/types";
import { BoardCard } from "./board-card";
import { fmtDay, fmtTime, manilaDay } from "./format";

/**
 * The Archive: Done cards finished more than ARCHIVE_AFTER_HOURS ago,
 * grouped by the Manila day they were finished, newest first. Opening a
 * card shows the same drawer as the board; moving it back to To do or In
 * progress puts it on the board again.
 */
export function ArchiveView({
  items,
  total,
  loading,
  filtered,
  selectedId,
  onSelect,
  onLoadMore,
}: {
  items: BoardItem[] | null;
  total: number;
  loading: boolean;
  /** A person, store or search is narrowing the list. */
  filtered: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const days = useMemo(() => {
    const groups: Array<{ day: string; items: BoardItem[] }> = [];
    for (const item of items ?? []) {
      const day = item.done_at ? manilaDay(item.done_at) : "";
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(item);
      else groups.push({ day, items: [item] });
    }
    return groups;
  }, [items]);

  if (items === null) {
    return (
      <div className="mt-10 flex justify-center">
        <Loader2 size={20} className="animate-spin text-gray-500" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-12 text-center">
        <Archive size={20} className="mx-auto text-gray-600" />
        <p className="text-sm text-gray-400 mt-3">{filtered ? "No archived cards match." : "Nothing archived yet."}</p>
        <p className="text-xs text-gray-600 mt-1">Done cards move here {ARCHIVE_AFTER_HOURS} hours after they are finished.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      {days.map((g) => (
        <section key={g.day || "undated"}>
          <header className="flex items-baseline gap-2 px-1 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{g.day ? fmtDay(g.day) : "No finish date"}</h2>
            <span className="text-xs text-gray-600">{g.items.length}</span>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {g.items.map((item) => (
              <BoardCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item.id)}
                doneLabel={item.done_at ? `done ${fmtTime(item.done_at)}` : "done"}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="flex items-center justify-center gap-3 text-xs text-gray-500 pb-4">
        <span>
          Showing {items.length} of {total}
        </span>
        {items.length < total && (
          <button type="button" onClick={onLoadMore} disabled={loading} className="inline-flex items-center gap-1.5 text-gray-300 hover:text-white cursor-pointer disabled:opacity-50">
            {loading && <Loader2 size={12} className="animate-spin" />} Load more
          </button>
        )}
      </div>
    </div>
  );
}
