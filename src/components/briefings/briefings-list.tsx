"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sunrise, Moon, CalendarDays, CalendarRange, ArrowRight, RefreshCw, Play, Hammer } from "lucide-react";
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
  const [rerunning, setRerunning] = useState<BriefingType | null>(null);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);

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

  const rebuild = useCallback(
    async (id: string, label: string) => {
      const confirmed = window.confirm(
        `Rebuild this briefing (${label})? The existing row will be deleted and re-generated with fresh data for its original period. No email will be re-sent.`
      );
      if (!confirmed) return;
      setRebuildingId(id);
      setRerunMsg(null);
      try {
        const res = await fetch(`/api/admin/briefing-backfill?id=${id}`, {
          method: "POST",
          cache: "no-store",
        });
        const body = (await res.json()) as {
          result?: { success?: boolean; error?: string };
          error?: string;
        };
        if (!res.ok || body.error || body.result?.success === false) {
          setRerunMsg(
            `Rebuild failed: ${body.error ?? body.result?.error ?? "unknown error"}`
          );
        } else {
          setRerunMsg(`Rebuild ok — ${label} regenerated.`);
          await load();
        }
      } catch (err) {
        setRerunMsg(
          `Rebuild failed: ${err instanceof Error ? err.message : "unknown"}`
        );
      } finally {
        setRebuildingId(null);
      }
    },
    [load]
  );

  const rerun = useCallback(
    async (type: BriefingType) => {
      const confirmed = window.confirm(
        `Rerun ${type} briefing? This will delete the existing row for the current period and rebuild it with fresh data.`
      );
      if (!confirmed) return;
      setRerunning(type);
      setRerunMsg(null);
      try {
        const res = await fetch(`/api/admin/briefing-rerun?type=${type}`, {
          method: "POST",
          cache: "no-store",
        });
        const body = (await res.json()) as {
          result?: { success?: boolean; error?: string };
          error?: string;
        };
        if (!res.ok || body.error || body.result?.success === false) {
          setRerunMsg(
            `Rerun failed: ${body.error ?? body.result?.error ?? "unknown error"}`
          );
        } else {
          setRerunMsg(`Rerun ok — ${type} briefing rebuilt.`);
          await load();
        }
      } catch (err) {
        setRerunMsg(
          `Rerun failed: ${err instanceof Error ? err.message : "unknown"}`
        );
      } finally {
        setRerunning(null);
      }
    },
    [load]
  );

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

      <div className="mb-4 bg-gray-900/30 border border-gray-800 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
            Rerun current period
          </p>
          {rerunMsg && (
            <span
              className={`text-[11px] ${
                rerunMsg.startsWith("Rerun ok") ? "text-green-400" : "text-red-400"
              }`}
            >
              {rerunMsg}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["morning", "evening", "weekly", "monthly"] as BriefingType[]).map((t) => (
            <button
              key={t}
              onClick={() => rerun(t)}
              disabled={rerunning !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-700 text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors capitalize"
            >
              {rerunning === t ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {rerunning === t ? `Rerunning ${t}…` : `Rerun ${t}`}
            </button>
          ))}
        </div>
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
          const rebuildLabel = `${meta.label} · ${b.period_label}`;
          const isRebuilding = rebuildingId === b.id;
          return (
            <div
              key={b.id}
              className="group relative bg-gray-900/40 hover:bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl transition-colors"
            >
              <Link
                href={`/admin/briefings/${b.id}`}
                className="block p-4"
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
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  rebuild(b.id, rebuildLabel);
                }}
                disabled={isRebuilding || rebuildingId !== null}
                title="Delete + regenerate this briefing for its original period (no email)"
                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-gray-700 bg-gray-900/80 text-gray-400 hover:text-white hover:border-gray-600 opacity-0 group-hover:opacity-100 disabled:opacity-100 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                {isRebuilding ? (
                  <RefreshCw size={10} className="animate-spin" />
                ) : (
                  <Hammer size={10} />
                )}
                {isRebuilding ? "Rebuilding…" : "Rebuild"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
