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

/** "1:14 PM" in Manila time. */
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

/** "2026-10-15": the Manila calendar day an instant falls on. */
export const manilaDay = (iso: string | number) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** "Today", "Yesterday", or "Wed, Oct 15" (with the year when it is not this year) for a Manila day. */
export const fmtDay = (ymd: string) => {
  const today = manilaDay(Date.now());
  if (ymd === today) return "Today";
  if (ymd === manilaDay(Date.now() - 86400_000)) return "Yesterday";
  const d = new Date(`${ymd}T12:00:00+08:00`);
  return d.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(ymd.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
};

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
