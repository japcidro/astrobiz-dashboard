"use client";

import { AlertTriangle, CalendarClock, Check, Loader2, MessageSquare, Play, Video } from "lucide-react";
import type { BoardItem } from "@/lib/marketing-board/types";
import { SourceBadge, fmtDue, isFuture, isOverdue } from "./format";

export function BoardCard({
  item,
  selected,
  onSelect,
  onDragStart,
}: {
  item: BoardItem;
  selected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
}) {
  const thumb = item.thumb_url ?? item.external_thumbnail_url;
  const scheduled = item.outputs.some((o) => isFuture(o.start_time));
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onClick={onSelect}
      className={`w-full text-left flex gap-3 rounded-lg border p-2 transition-colors cursor-pointer ${
        selected ? "border-purple-500 bg-purple-500/10" : "border-gray-700/80 bg-gray-800/60 hover:bg-gray-800"
      }`}
    >
      <div className="relative w-14 shrink-0 aspect-[9/16] rounded-md bg-gray-950 overflow-hidden">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Play size={18} />
          </div>
        )}
        {item.video_status !== "ready" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            {item.video_status === "failed" ? (
              <AlertTriangle size={14} className="text-red-300" />
            ) : (
              <Loader2 size={14} className="text-white animate-spin" />
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceBadge type={item.source_type} />
          {item.store && <span className="text-[10px] text-gray-500 truncate">{item.store}</span>}
        </div>
        <p className="text-sm text-white font-medium mt-1 leading-snug line-clamp-2">{item.title || item.source_url}</p>
        <p className="text-[11px] text-gray-500 mt-1 truncate">
          {item.assignee_name ?? "Unassigned"}
          {item.due_date && item.status !== "done" && (
            <span className={isOverdue(item.due_date) ? " text-red-300" : ""}> · due {fmtDue(item.due_date)}</span>
          )}
        </p>
        <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={10} /> {item.comments.length}
          </span>
          {item.outputs.length > 0 && (
            <span className="inline-flex items-center gap-1 text-green-400">
              <Video size={10} /> {item.outputs.length}
            </span>
          )}
          {scheduled && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <CalendarClock size={10} /> scheduled
            </span>
          )}
          {item.status === "done" && !scheduled && (
            <span className="inline-flex items-center gap-1 text-green-400">
              <Check size={10} /> done
            </span>
          )}
        </p>
      </div>
    </button>
  );
}
