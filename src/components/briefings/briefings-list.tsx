"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sunrise, Moon, CalendarDays, CalendarRange, ArrowRight, RefreshCw } from "lucide-react";
import type { BriefingType } from "@/lib/briefings/types";

interface BriefingRow {
  id: string;
  type: BriefingType;
  period_label: string;
  headline: string;
  ai_summary: string | null;
  created_at: string;
  email_sent_at: string | null;
}

const TYPE_META: Record<BriefingType, { label: string; icon: React.ReactNode; color: string }> = {
  morning: {
    label: "Morning",
    icon: <Sunrise size={14} />,
    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  evening: {
    label: "Evening",
    icon: <Moon size={14} />,
    color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  },
  weekly: {
    label: "Weekly",
    icon: <CalendarDays size={14} />,
    color: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  monthly: {
    label: "Monthly",
    icon: <CalendarRange size={14} />,
    color: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
};

type Filter = "all" | BriefingType;

export function BriefingsList() {
  const [filter, setFilter] = useState<Filter>("all");
  const [briefings, setBriefings] = useState<BriefingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "all" ? "" : `?type=${filter}`;
      const res = await fetch(`/api/briefings/list${q}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { briefings: BriefingRow[] };
      setBriefings(data.briefings);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex gap-1 bg-gray-900/50 border border-gray-800 rounded-lg p-1 overflow-x-auto">
          {(["all", "morning", "evening", "weekly", "monthly"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                filter === f ? "bg-white text-gray-900" : "text-gray-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!loading && briefings.length === 0 && (
        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-10 text-center">
          <p className="text-gray-400">No briefings yet.</p>
          <p className="text-xs text-gray-600 mt-2">
            Morning and evening briefings generate automatically. First one arrives overnight.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {briefings.map((b) => {
          const meta = TYPE_META[b.type];
          const summaryPreview = b.ai_summary
            ? b.ai_summary.split(/\n\n+/)[0].slice(0, 160) +
              (b.ai_summary.length > 160 ? "…" : "")
            : null;
          return (
            <Link
              key={b.id}
              href={`/admin/briefings/${b.id}`}
              className="block bg-gray-900/40 hover:bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.color}`}
                >
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color.split(" ")[1]}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-xs text-gray-500">{b.period_label}</span>
                  </div>
                  <p className="text-sm font-medium text-white leading-snug">
                    {b.headline}
                  </p>
                  {summaryPreview && (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {summaryPreview}
                    </p>
                  )}
                </div>
                <ArrowRight size={16} className="text-gray-600 flex-shrink-0 mt-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
