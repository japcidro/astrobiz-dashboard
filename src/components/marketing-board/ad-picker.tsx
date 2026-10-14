"use client";

import { CalendarClock, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { SubmittedAdOption } from "@/lib/marketing-board/types";
import { api } from "@/components/hook-studio/ui";
import { fmtWhen, isFuture } from "./format";

/**
 * Pick an ad the marketer submitted through Create / Bulk Create. Recent
 * submissions show at once; typing filters by ad name.
 */
export function AdPicker({
  attachedAdIds,
  onPick,
  onClose,
}: {
  attachedAdIds: Set<string>;
  onPick: (ad: SubmittedAdOption) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [ads, setAds] = useState<SubmittedAdOption[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api<{ ads: SubmittedAdOption[] }>(`/api/owner/marketing-board/ads?q=${encodeURIComponent(q)}`)
        .then((r) => live && setAds(r.ads))
        .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load ads"));
    }, q ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-3">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-gray-500 shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search submitted ads by name…"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
        />
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white cursor-pointer">
          Cancel
        </button>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
        {error && <p className="text-xs text-red-300">{error}</p>}
        {ads === null && !error && <Loader2 size={16} className="mx-auto my-4 text-gray-500 animate-spin" />}
        {ads?.length === 0 && (
          <p className="text-xs text-gray-500 py-3 text-center">
            {q ? "No submitted ad matches." : "No ads submitted in the last 45 days."}
          </p>
        )}
        {ads?.map((ad) => {
          const attached = attachedAdIds.has(ad.fb_ad_id);
          const scheduled = isFuture(ad.start_time);
          return (
            <button
              key={ad.draft_id}
              type="button"
              disabled={attached || busyId !== null}
              onClick={async () => {
                setBusyId(ad.draft_id);
                try {
                  await onPick(ad);
                } finally {
                  setBusyId(null);
                }
              }}
              className="w-full text-left rounded-lg px-3 py-2 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <p className="text-sm text-white truncate">{ad.ad_name}</p>
              <p className="text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
                {ad.employee_name && <span>{ad.employee_name}</span>}
                {ad.submitted_at && <span>· submitted {fmtWhen(ad.submitted_at)}</span>}
                {ad.start_time && (
                  <span className={`inline-flex items-center gap-1 ${scheduled ? "text-amber-300" : ""}`}>
                    · <CalendarClock size={10} /> {scheduled ? "runs" : "started"} {fmtWhen(ad.start_time)}
                  </span>
                )}
                {attached && <span className="text-green-400">· attached</span>}
                {busyId === ad.draft_id && <Loader2 size={10} className="animate-spin" />}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
