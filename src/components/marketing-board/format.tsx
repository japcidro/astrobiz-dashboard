import type { ReactNode } from "react";
import { SOURCE_LABEL, type SourceType } from "@/lib/marketing-board/types";

/** "Oct 15, 9:00 AM" in Manila time, the team's clock. */
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "Fri, Oct 17" for a date-only due date. */
export const fmtDue = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });

export const isOverdue = (ymd: string) => new Date(`${ymd}T23:59:59`).getTime() < Date.now();

/** A scheduled start that has not happened yet. */
export const isFuture = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() > Date.now();

const SOURCE_TONE: Record<SourceType, string> = {
  tiktok: "bg-pink-900/40 text-pink-200 border-pink-800/60",
  fb_ads_library: "bg-blue-900/40 text-blue-200 border-blue-800/60",
  facebook: "bg-blue-900/40 text-blue-200 border-blue-800/60",
  instagram: "bg-fuchsia-900/40 text-fuchsia-200 border-fuchsia-800/60",
  youtube: "bg-red-900/40 text-red-200 border-red-800/60",
  other: "bg-gray-700/40 text-gray-300 border-gray-600/60",
};

export function SourceBadge({ type, children }: { type: SourceType; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SOURCE_TONE[type]}`}>
      {children ?? SOURCE_LABEL[type]}
    </span>
  );
}
