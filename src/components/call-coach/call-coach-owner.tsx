"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Headphones, Loader2, Mic, MicOff, Pause, Play, RefreshCw } from "lucide-react";
import { api } from "@/components/hook-studio/ui";
import {
  RETENTION_DAYS,
  formatClock,
  formatMinutes,
  type DayResponse,
  type MicEventKind,
  type OverviewEmployee,
  type OverviewResponse,
} from "@/lib/call-coach/shared";

/**
 * Phase 1 of Call Coach: what was recorded, per VA per day, with a player
 * for every stored minute. Phase 2 puts transcripts and scores on this page.
 */
export function CallCoachOwner() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ employee: OverviewEmployee; date: string } | null>(null);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [dayBusy, setDayBusy] = useState(false);

  const refresh = useCallback(
    () =>
      api<OverviewResponse>("/api/call-coach/overview")
        .then((data) => {
          setOverview(data);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load")),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const pick = useCallback((employee: OverviewEmployee, date: string) => {
    setPicked({ employee, date });
    setDay(null);
    setDayBusy(true);
    api<DayResponse>(`/api/call-coach/day?employee_id=${employee.id}&date=${date}`)
      .then((d) => setDay(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load that day"))
      .finally(() => setDayBusy(false));
  }, []);

  const totals = useMemo(() => {
    if (!overview) return { today: 0, week: 0 };
    const today = overview.dates[0];
    const week = new Set(overview.dates.slice(0, 7));
    let t = 0;
    let w = 0;
    for (const e of overview.employees) {
      for (const [d, cell] of Object.entries(e.days)) {
        if (d === today) t += cell.voice_seconds;
        if (week.has(d)) w += cell.voice_seconds;
      }
    }
    return { today: t, week: w };
  }, [overview]);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Headphones size={24} className="text-purple-400" /> Call Coach
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            What the VAs&apos; microphones captured, per shift. Silent minutes are never stored. Audio is deleted after {RETENTION_DAYS} days.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-2 cursor-pointer"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Speech saved today" value={formatMinutes(totals.today)} />
        <Stat label="Last 7 days" value={formatMinutes(totals.week)} />
        <Stat label="Recorded staff" value={String(overview?.employees.filter((e) => e.consented_at).length ?? "–")} sub="signed consent" />
        <Stat label="Phase" value="1 · Record" sub="transcripts and scores come in Phase 2" />
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="text-left font-semibold px-4 py-3 sticky left-0 bg-gray-800/90">Employee</th>
                {overview?.dates.map((d) => (
                  <th key={d} className="font-semibold px-2 py-3 text-center whitespace-nowrap">
                    {dayLabel(d, overview.dates[0])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!overview && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-gray-500">
                    <Loader2 size={18} className="inline animate-spin mr-2" /> Loading…
                  </td>
                </tr>
              )}
              {overview?.employees.map((e) => (
                <tr key={e.id} className="border-t border-gray-700/60">
                  <td className="px-4 py-3 sticky left-0 bg-gray-800/90">
                    <div className="text-white font-medium whitespace-nowrap">{e.full_name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                      {e.consented_at ? (
                        <>
                          <Mic size={11} className="text-green-400" /> consent signed {new Date(e.consented_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                        </>
                      ) : (
                        <>
                          <MicOff size={11} className="text-gray-600" /> not signed yet
                        </>
                      )}
                    </div>
                  </td>
                  {overview.dates.map((d) => {
                    const cell = e.days[d];
                    const active = picked?.employee.id === e.id && picked.date === d;
                    return (
                      <td key={d} className="px-1.5 py-2 text-center">
                        {cell ? (
                          <button
                            type="button"
                            onClick={() => pick(e, d)}
                            className={`w-full rounded-md px-2 py-1.5 font-mono text-xs transition-colors cursor-pointer ${
                              active ? "bg-purple-600 text-white" : "bg-green-900/40 text-green-300 hover:bg-green-800/60"
                            }`}
                            title={`${cell.segments} saved minutes, ${formatClock(cell.first_at)} to ${formatClock(cell.last_at)}`}
                          >
                            {formatMinutes(cell.voice_seconds)}
                          </button>
                        ) : (
                          <span className="text-gray-700">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {overview && overview.employees.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-gray-500">
                    No VA or admin accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {picked && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-white">
              {picked.employee.full_name} ·{" "}
              {new Date(`${picked.date}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" })}
            </h2>
            {day && (
              <span className="text-sm text-gray-400">
                {day.segments.length} saved {day.segments.length === 1 ? "minute" : "minutes"} ·{" "}
                {formatMinutes(day.segments.reduce((s, x) => s + x.voice_seconds, 0))} of speech
              </span>
            )}
          </div>

          {dayBusy && !day && (
            <p className="text-sm text-gray-500">
              <Loader2 size={16} className="inline animate-spin mr-2" /> Loading…
            </p>
          )}

          {day && <DayTimeline day={day} />}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-white mt-1 font-mono">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  return new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", timeZone: "Asia/Manila" });
}

const EVENT_LABEL: Record<MicEventKind, string> = {
  started: "Recording started",
  paused: "Paused for a break",
  resumed: "Recording resumed",
  lost: "Microphone lost",
  blocked: "Microphone blocked by the browser",
  stopped: "Clocked out, recording stopped",
  silent: "silent",
};

/**
 * The day in order: mic events and saved minutes interleaved. Silent minutes
 * are folded into a count between items, so a quiet hour reads as one line.
 */
function DayTimeline({ day }: { day: DayResponse }) {
  type Item =
    | { kind: "segment"; at: string; seg: DayResponse["segments"][number] }
    | { kind: "event"; at: string; ev: DayResponse["events"][number] }
    | { kind: "silence"; at: string; count: number };

  const items = useMemo<Item[]>(() => {
    const raw: Item[] = [
      ...day.segments.map((seg) => ({ kind: "segment" as const, at: seg.started_at, seg })),
      ...day.events.filter((ev) => ev.kind !== "silent").map((ev) => ({ kind: "event" as const, at: ev.at, ev })),
      ...day.events.filter((ev) => ev.kind === "silent").map((ev) => ({ kind: "silence" as const, at: ev.at, count: 1 })),
    ];
    raw.sort((a, b) => a.at.localeCompare(b.at));
    const folded: Item[] = [];
    for (const it of raw) {
      const prev = folded[folded.length - 1];
      if (it.kind === "silence" && prev?.kind === "silence") prev.count += 1;
      else folded.push({ ...it });
    }
    return folded;
  }, [day]);

  if (items.length === 0) return <p className="text-sm text-gray-500">Nothing recorded on this day.</p>;

  return (
    <ol className="space-y-1.5">
      {items.map((it, i) => {
        if (it.kind === "silence") {
          return (
            <li key={i} className="flex items-center gap-3 text-xs text-gray-600 pl-[72px] py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
              {it.count} quiet {it.count === 1 ? "minute" : "minutes"}, not stored
            </li>
          );
        }
        if (it.kind === "event") {
          const warn = it.ev.kind === "lost" || it.ev.kind === "blocked";
          return (
            <li key={it.ev.id} className={`flex items-center gap-3 text-xs py-1 ${warn ? "text-amber-300" : "text-gray-400"}`}>
              <span className="font-mono w-[60px] text-gray-500">{formatClock(it.ev.at)}</span>
              {it.ev.kind === "paused" ? <Pause size={12} /> : it.ev.kind === "resumed" || it.ev.kind === "started" ? <Play size={12} /> : <AlertTriangle size={12} />}
              {EVENT_LABEL[it.ev.kind]}
              {it.ev.detail && it.ev.kind !== "silent" && <span className="text-gray-600">({it.ev.detail})</span>}
            </li>
          );
        }
        const { seg } = it;
        return (
          <li key={seg.id} className="flex flex-wrap items-center gap-3 bg-gray-900/50 border border-gray-700/60 rounded-lg px-3 py-2">
            <span className="font-mono text-xs text-white w-[60px]">{formatClock(seg.started_at)}</span>
            <span className="text-xs text-gray-400 w-[90px]">
              {Math.round(seg.voice_seconds)}s voice / {Math.round(seg.duration_seconds)}s
            </span>
            {seg.url ? (
              <audio controls preload="none" src={seg.url} className="h-8 flex-1 min-w-[220px]" />
            ) : (
              <span className="text-xs text-gray-600 flex-1">Audio not available</span>
            )}
            <span className="text-[11px] text-gray-600 font-mono">{(seg.bytes / 1024).toFixed(0)} KB</span>
          </li>
        );
      })}
    </ol>
  );
}
