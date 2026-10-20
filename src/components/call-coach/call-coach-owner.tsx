"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { api } from "@/components/hook-studio/ui";
import {
  RETENTION_DAYS,
  RUBRIC_ITEMS,
  formatClock,
  formatMinutes,
  scoreTone,
  type CallRow,
  type DayResponse,
  type DigestRow,
  type MicEventKind,
  type OverviewEmployee,
  type OverviewResponse,
  type ReviewRow,
} from "@/lib/call-coach/shared";

/**
 * Call Coach for the owner: per VA per day, what was recorded, what Claude
 * made of it (calls, scores, coaching), and a player that jumps to the exact
 * moment a note refers to.
 */
export function CallCoachOwner() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ employee: OverviewEmployee; date: string } | null>(null);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);

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

  const loadDay = useCallback((employee: OverviewEmployee, date: string) => {
    setDayBusy(true);
    return api<DayResponse>(`/api/call-coach/day?employee_id=${employee.id}&date=${date}`)
      .then((d) => setDay(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load that day"))
      .finally(() => setDayBusy(false));
  }, []);

  const pick = useCallback(
    (employee: OverviewEmployee, date: string) => {
      setPicked({ employee, date });
      setDay(null);
      void loadDay(employee, date);
    },
    [loadDay],
  );

  const reviewNow = useCallback(() => {
    if (!picked) return;
    setReviewing(true);
    setError(null);
    api<{ status: string; reason?: string }>("/api/call-coach/review", {
      method: "POST",
      body: JSON.stringify({ employee_id: picked.employee.id, date: picked.date }),
    })
      .then((r) => {
        if (r.status === "skipped" && r.reason) setError(r.reason);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Review failed"))
      .finally(() => {
        setReviewing(false);
        void loadDay(picked.employee, picked.date);
        void refresh();
      });
  }, [picked, loadDay, refresh]);

  const totals = useMemo(() => {
    if (!overview) return { today: 0, week: 0, weekScore: null as number | null, weekCalls: 0 };
    const today = overview.dates[0];
    const week = new Set(overview.dates.slice(0, 7));
    let t = 0;
    let w = 0;
    let scoreSum = 0;
    let scoreN = 0;
    let calls = 0;
    for (const e of overview.employees) {
      for (const [d, cell] of Object.entries(e.days)) {
        if (d === today) t += cell.voice_seconds;
        if (week.has(d)) w += cell.voice_seconds;
      }
      for (const [d, r] of Object.entries(e.reviews)) {
        if (!week.has(d) || r.status !== "done") continue;
        calls += r.calls;
        if (r.score !== null) {
          scoreSum += r.score;
          scoreN += 1;
        }
      }
    }
    return { today: t, week: w, weekScore: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null, weekCalls: calls };
  }, [overview]);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Headphones size={24} className="text-purple-400" /> Call Coach
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            VA shifts recorded from the PC mic, transcribed by Gemini every 30 minutes and reviewed by Claude at 11:30 PM. Silent minutes are never
            stored. Audio is deleted after {RETENTION_DAYS} days; transcripts and scores stay.
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
        <Stat label="Last 7 days" value={formatMinutes(totals.week)} sub={`${totals.weekCalls} calls reviewed`} />
        <Stat label="Team score, 7 days" value={totals.weekScore === null ? "–" : totals.weekScore.toFixed(1)} sub="average of reviewed days, out of 5" />
        <Stat label="Recorded staff" value={String(overview?.employees.filter((e) => e.consented_at).length ?? "–")} sub="signed consent" />
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
                          <Mic size={11} className="text-green-400" /> consent signed{" "}
                          {new Date(e.consented_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
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
                    const rev = e.reviews[d];
                    const active = picked?.employee.id === e.id && picked.date === d;
                    return (
                      <td key={d} className="px-1.5 py-2 text-center">
                        {cell ? (
                          <button
                            type="button"
                            onClick={() => pick(e, d)}
                            className={`w-full rounded-md px-1.5 py-1.5 transition-colors cursor-pointer border ${
                              active ? "bg-purple-600/80 border-purple-400 text-white" : "bg-gray-900/60 border-gray-700 hover:border-gray-500"
                            }`}
                            title={`${cell.segments} saved minutes, ${formatClock(cell.first_at)} to ${formatClock(cell.last_at)}`}
                          >
                            <div className={`font-mono text-sm font-semibold ${scoreClass(rev?.status === "done" ? rev.score : null, active)}`}>
                              {rev?.status === "done" && rev.score !== null ? rev.score.toFixed(1) : rev?.status === "running" ? "…" : "–"}
                            </div>
                            <div className={`text-[10px] font-mono ${active ? "text-purple-100" : "text-gray-500"}`}>{formatMinutes(cell.voice_seconds)}</div>
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
        <p className="text-[11px] text-gray-600 px-4 py-2 border-t border-gray-700/60">
          Each cell: the day&apos;s score out of 5 (dash until Claude has reviewed it) over the minutes of speech saved.
        </p>
      </div>

      {picked && (
        <DayPanel
          employee={picked.employee}
          date={picked.date}
          day={day}
          busy={dayBusy}
          reviewing={reviewing}
          onReview={reviewNow}
          pending={picked.employee.reviews[picked.date]?.pending ?? 0}
        />
      )}

      {picked && <DigestPanel employee={picked.employee} onOpenDay={(date) => pick(picked.employee, date)} />}

      <RubricEditor />
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

function scoreClass(score: number | null | undefined, active = false): string {
  if (active) return "text-white";
  const tone = scoreTone(score);
  return tone === "good" ? "text-green-300" : tone === "mid" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-gray-500";
}

const OUTCOME_LABEL: Record<CallRow["outcome"], { label: string; cls: string }> = {
  confirmed: { label: "Confirmed", cls: "text-green-300 border-green-800/60 bg-green-900/30" },
  cancelled: { label: "Cancelled", cls: "text-red-300 border-red-800/60 bg-red-900/30" },
  callback: { label: "Callback", cls: "text-amber-300 border-amber-800/60 bg-amber-900/30" },
  no_answer: { label: "No answer", cls: "text-gray-400 border-gray-700 bg-gray-800/60" },
  wrong_number: { label: "Wrong number", cls: "text-gray-400 border-gray-700 bg-gray-800/60" },
  not_sales: { label: "Not a sales call", cls: "text-gray-500 border-gray-700 bg-gray-800/40" },
  unclear: { label: "Unclear", cls: "text-gray-400 border-gray-700 bg-gray-800/60" },
};

const FLAG_CLASS: Record<string, string> = {
  great_call: "text-green-300 bg-green-900/30",
  rts_risk: "text-red-300 bg-red-900/30",
  wrong_info: "text-red-300 bg-red-900/30",
  no_upsell: "text-amber-300 bg-amber-900/30",
  rushed: "text-amber-300 bg-amber-900/30",
};

function DayPanel({
  employee,
  date,
  day,
  busy,
  reviewing,
  onReview,
  pending,
}: {
  employee: OverviewEmployee;
  date: string;
  day: DayResponse | null;
  busy: boolean;
  reviewing: boolean;
  onReview: () => void;
  pending: number;
}) {
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const [showTranscripts, setShowTranscripts] = useState(false);

  // Jump the player to a moment: the saved minute that contains it, at the right offset.
  const playAt = useCallback(
    (iso: string) => {
      if (!day) return;
      const t = new Date(iso).getTime();
      const seg =
        day.segments.find((s) => new Date(s.started_at).getTime() <= t && t <= new Date(s.ended_at).getTime()) ??
        day.segments.reduce<DayResponse["segments"][number] | null>((best, s) => {
          const d = Math.abs(new Date(s.started_at).getTime() - t);
          return !best || d < Math.abs(new Date(best.started_at).getTime() - t) ? s : best;
        }, null);
      if (!seg) return;
      const el = audioRefs.current.get(seg.id);
      if (!el) return;
      for (const other of audioRefs.current.values()) if (other !== el) other.pause();
      el.currentTime = Math.max(0, (t - new Date(seg.started_at).getTime()) / 1000 - 1.5);
      void el.play().catch(() => {});
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [day],
  );

  const review = day?.review ?? null;
  const transcribed = day?.segments.filter((s) => s.status !== "stored" && s.status !== "failed").length ?? 0;
  const failed = day?.segments.filter((s) => s.status === "failed").length ?? 0;
  const waiting = day?.segments.filter((s) => s.status === "stored").length ?? pending;

  return (
    <div className="space-y-4">
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {employee.full_name} ·{" "}
              {new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" })}
            </h2>
            {day && (
              <p className="text-sm text-gray-400 mt-0.5">
                {day.segments.length} saved {day.segments.length === 1 ? "minute" : "minutes"} ·{" "}
                {formatMinutes(day.segments.reduce((s, x) => s + x.voice_seconds, 0))} of speech · {transcribed} transcribed
                {waiting > 0 && <span className="text-amber-300"> · {waiting} waiting</span>}
                {failed > 0 && <span className="text-red-300"> · {failed} failed</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onReview}
            disabled={reviewing || busy || !day || day.segments.length === 0}
            className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            title="Transcribe anything still waiting, then have Claude review the whole day again"
          >
            {reviewing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {reviewing ? "Reviewing… this takes a minute" : review ? "Review again" : "Review now"}
          </button>
        </div>

        {busy && !day && (
          <p className="text-sm text-gray-500 mt-4">
            <Loader2 size={16} className="inline animate-spin mr-2" /> Loading…
          </p>
        )}

        {day && !review && !reviewing && (
          <p className="text-sm text-gray-500 mt-4">
            Not reviewed yet. Claude reviews every recorded day at 11:30 PM, or click Review now.
            {waiting > 0 && " Minutes still waiting are transcribed first."}
          </p>
        )}

        {review && review.status === "failed" && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            The last review failed: {review.error ?? "unknown error"}. Click Review again.
          </div>
        )}

        {review && review.status === "done" && <ReviewCard review={review} />}
      </div>

      {day && day.calls.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-3">
            Calls <span className="text-gray-500 font-normal">· click a moment to hear it</span>
          </h3>
          <ol className="space-y-3">
            {day.calls.map((c) => (
              <CallCard key={c.id} call={c} onPlay={playAt} />
            ))}
          </ol>
        </div>
      )}

      {day && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base font-semibold text-white">Recording</h3>
            <button
              type="button"
              onClick={() => setShowTranscripts((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white cursor-pointer"
            >
              <FileText size={13} /> {showTranscripts ? "Hide transcripts" : "Show transcripts"}
            </button>
          </div>
          <DayTimeline day={day} audioRefs={audioRefs} showTranscripts={showTranscripts} />
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewRow }) {
  const upsellRate = review.reached_count > 0 ? Math.round((review.upsell_attempted / review.reached_count) * 100) : null;
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini label="Day score" value={review.score === null ? "–" : review.score.toFixed(1)} tone={scoreTone(review.score)} sub="out of 5" />
        <Mini label="Calls" value={String(review.calls_count)} sub={`${review.reached_count} reached · ${review.calls_count - review.reached_count} no answer`} />
        <Mini label="Confirmed on the call" value={String(review.confirmed_count)} sub={`of ${review.reached_count} reached`} />
        <Mini
          label="Upsell attempted"
          value={upsellRate === null ? "–" : `${upsellRate}%`}
          tone={upsellRate === null ? "none" : upsellRate >= 60 ? "good" : upsellRate >= 35 ? "mid" : "bad"}
          sub={`${review.upsell_attempted} tried · ${review.upsell_converted} took it`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Rubric, day average</p>
          <div className="space-y-2">
            {RUBRIC_ITEMS.map((item) => {
              const v = review.scores[item.key] ?? null;
              const tone = scoreTone(v);
              return (
                <div key={item.key} className="grid grid-cols-[150px_1fr_36px] items-center gap-3 text-sm">
                  <span className="text-gray-300 truncate">{item.label}</span>
                  <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${tone === "good" ? "bg-green-400" : tone === "mid" ? "bg-amber-400" : tone === "bad" ? "bg-red-400" : "bg-gray-700"}`}
                      style={{ width: v === null ? "0%" : `${(v / 5) * 100}%` }}
                    />
                  </div>
                  <span className={`font-mono text-xs text-right ${scoreClass(v)}`}>{v === null ? "n/a" : v.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">What Claude saw</p>
            <p className="text-sm text-gray-300 leading-relaxed">{review.summary}</p>
          </div>
          {review.coaching.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Coach on</p>
              <ul className="space-y-1.5">
                {review.coaching.map((c, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-purple-400 mt-0.5">▸</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.non_call_notes && <p className="text-xs text-gray-500 leading-relaxed">{review.non_call_notes}</p>}
          <p className="text-[11px] text-gray-600 font-mono">
            {review.model} · {review.input_tokens ?? 0} in / {review.output_tokens ?? 0} out · reviewed {formatClock(review.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: ReturnType<typeof scoreTone> }) {
  const cls = tone === "good" ? "text-green-300" : tone === "mid" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-white";
  return (
    <div className="bg-gray-900/50 border border-gray-700/60 rounded-lg p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-xl font-bold font-mono mt-0.5 ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function CallCard({ call, onPlay }: { call: CallRow; onPlay: (iso: string) => void }) {
  const [open, setOpen] = useState(call.outcome !== "not_sales" && call.outcome !== "no_answer");
  const outcome = OUTCOME_LABEL[call.outcome] ?? OUTCOME_LABEL.unclear;
  const minutes = Math.max(1, Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 60000));
  return (
    <li className="bg-gray-900/50 border border-gray-700/60 rounded-lg">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex flex-wrap items-center gap-3 px-3 py-2.5 text-left cursor-pointer">
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
        <span className="font-mono text-xs text-white w-[60px]">{formatClock(call.started_at)}</span>
        <span className="text-xs text-gray-500 w-[44px]">{minutes} min</span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${outcome.cls}`}>{outcome.label}</span>
        {call.overall !== null && <span className={`font-mono text-sm font-semibold ${scoreClass(call.overall)}`}>{call.overall.toFixed(1)}</span>}
        {call.upsell_attempted && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${call.upsell_converted ? "text-green-300 bg-green-900/30" : "text-gray-300 bg-gray-800"}`}>
            upsell {call.upsell_converted ? "taken" : "offered"}
          </span>
        )}
        {call.flags.map((f) => (
          <span key={f} className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${FLAG_CLASS[f] ?? "text-gray-400 bg-gray-800"}`}>
            {f.replace(/_/g, " ")}
          </span>
        ))}
        {!call.customer_audible && call.outcome !== "not_sales" && <span className="text-[11px] text-gray-600 ml-auto">VA side only</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9 space-y-3">
          <p className="text-sm text-gray-300 leading-relaxed">{call.summary}</p>
          {call.outcome !== "not_sales" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {RUBRIC_ITEMS.map((item) => {
                const v = call.scores[item.key] ?? null;
                return (
                  <span key={item.key} className="text-[11px] text-gray-500">
                    {item.label.split(" &")[0]} <span className={`font-mono ${scoreClass(v)}`}>{v === null ? "n/a" : v}</span>
                  </span>
                );
              })}
            </div>
          )}
          {call.moments.length > 0 && (
            <ul className="space-y-1.5">
              {call.moments.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onPlay(m.at)}
                    className="inline-flex items-center gap-1 font-mono text-xs text-blue-300 hover:text-white border border-blue-900/60 hover:border-blue-500 rounded px-1.5 py-0.5 cursor-pointer whitespace-nowrap"
                    title="Play this moment"
                  >
                    <Play size={10} /> {formatClock(m.at)}
                  </button>
                  <span className="text-[11px] font-mono text-amber-300 mt-1">{m.tag}</span>
                  <span className="text-gray-300">
                    {m.note}
                    {m.quote && <span className="text-gray-500 italic"> “{m.quote}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
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
function DayTimeline({
  day,
  audioRefs,
  showTranscripts,
}: {
  day: DayResponse;
  audioRefs: React.RefObject<Map<string, HTMLAudioElement>>;
  showTranscripts: boolean;
}) {
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
        const statusLabel =
          seg.status === "stored" ? "waiting for transcript" : seg.status === "failed" ? `transcription failed${seg.transcribe_error ? `: ${seg.transcribe_error}` : ""}` : null;
        return (
          <li key={seg.id} className="bg-gray-900/50 border border-gray-700/60 rounded-lg px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-white w-[60px]">{formatClock(seg.started_at)}</span>
              <span className="text-xs text-gray-400 w-[90px]">
                {Math.round(seg.voice_seconds)}s voice / {Math.round(seg.duration_seconds)}s
              </span>
              {seg.url ? (
                <audio
                  controls
                  preload="none"
                  src={seg.url}
                  className="h-8 flex-1 min-w-[220px]"
                  ref={(el) => {
                    if (el) audioRefs.current.set(seg.id, el);
                    else audioRefs.current.delete(seg.id);
                  }}
                />
              ) : (
                <span className="text-xs text-gray-600 flex-1">Audio not available</span>
              )}
              {statusLabel && <span className={`text-[11px] ${seg.status === "failed" ? "text-red-300" : "text-amber-300"}`}>{statusLabel}</span>}
              {seg.transcript?.language && seg.transcript.language !== "none" && (
                <span className="text-[11px] text-gray-600 font-mono">{seg.transcript.language}</span>
              )}
            </div>
            {showTranscripts && seg.transcript && (
              <pre className="mt-2 text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed border-t border-gray-800 pt-2">
                {seg.transcript.text || "(no words)"}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RubricEditor() {
  const [open, setOpen] = useState(false);
  const [rubric, setRubric] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ rubric: string; is_default: boolean }>("/api/call-coach/rubric")
        .then((r) => {
          setRubric(r.rubric);
          setIsDefault(r.is_default);
          setLoaded(true);
        })
        .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "Could not load the rubric")),
    [],
  );

  const toggle = () => {
    setOpen((v) => !v);
    if (!loaded) void load();
  };

  const save = (value: string) => {
    setSaving(true);
    setMsg(null);
    api<{ rubric: string; is_default: boolean }>("/api/call-coach/rubric", { method: "PUT", body: JSON.stringify({ rubric: value }) })
      .then((r) => {
        setRubric(r.rubric);
        setIsDefault(r.is_default);
        setMsg(r.is_default ? "Back to the default rubric. Applies to the next review." : "Saved. Applies to the next review.");
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "Could not save"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2 px-5 py-3 text-left cursor-pointer">
        {open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        <span className="text-sm font-semibold text-white">Scoring rubric</span>
        <span className="text-xs text-gray-500">{isDefault ? "default" : "edited"} · what Claude scores against</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <p className="text-xs text-gray-500">
            Plain text, read by Claude before every review. Change what a 5 means, add your own good-call examples, add flags. Keep the six item keys in
            parentheses (greeting, confirmation, upsell, objection, tone, closing) so the scorecard bars still line up.
          </p>
          <textarea
            id="call-coach-rubric"
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={16}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono leading-relaxed focus:outline-none focus:border-purple-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => save(rubric)}
              disabled={saving || !loaded}
              className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium py-2 px-4 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Saving…" : "Save rubric"}
            </button>
            {!isDefault && (
              <button
                type="button"
                onClick={() => save("")}
                disabled={saving}
                className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 py-2 px-4 rounded-lg cursor-pointer"
              >
                Reset to default
              </button>
            )}
            {msg && <span className="text-xs text-gray-400">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Monday digests for one VA: week score with trend, wins, what to coach,
 * and the clips to replay together (a click opens that day's scorecard).
 */
function DigestPanel({ employee, onOpenDay }: { employee: OverviewEmployee; onOpenDay: (date: string) => void }) {
  const [digests, setDigests] = useState<DigestRow[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ digests: DigestRow[] }>(`/api/call-coach/digests?employee_id=${employee.id}`)
        .then((r) => setDigests(r.digests))
        .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "Could not load digests")),
    [employee.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const build = () => {
    setBuilding(true);
    setMsg(null);
    api<{ status: string; reason?: string }>("/api/call-coach/digests", { method: "POST", body: JSON.stringify({ employee_id: employee.id }) })
      .then((r) => {
        if (r.status === "skipped") setMsg(r.reason ?? "Nothing to digest yet");
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : "Digest failed"))
      .finally(() => {
        setBuilding(false);
        void load();
      });
  };

  const weekLabel = (d: DigestRow) =>
    `${new Date(`${d.week_start}T00:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })} to ${new Date(`${d.week_end}T00:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}`;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Monday digests · {employee.full_name.split(" ")[0]}</h3>
          <p className="text-xs text-gray-500 mt-0.5">Written by Claude Opus every Monday 7 AM from the week&apos;s reviews. The VA sees only their own note on My Calls.</p>
        </div>
        <button
          type="button"
          onClick={build}
          disabled={building}
          className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-2 disabled:opacity-50 cursor-pointer"
          title="Write (or rewrite) the digest for the week that just ended"
        >
          {building ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {building ? "Writing…" : "Write last week's digest"}
        </button>
      </div>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
      {digests === null && (
        <p className="text-sm text-gray-500">
          <Loader2 size={14} className="inline animate-spin mr-2" /> Loading…
        </p>
      )}
      {digests && digests.length === 0 && <p className="text-sm text-gray-500">No digest yet. The first one lands the Monday after a reviewed week.</p>}
      {digests?.map((d) => (
        <div key={d.id} className="bg-gray-900/50 border border-gray-700/60 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-white">{weekLabel(d)}</span>
            {d.status === "done" ? (
              <>
                <span className={`font-mono text-lg font-bold ${scoreClass(d.score)}`}>{d.score === null ? "–" : d.score.toFixed(1)}</span>
                {d.score !== null && d.prev_score !== null && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    {d.score > d.prev_score ? <TrendingUp size={14} className="text-green-400" /> : d.score < d.prev_score ? <TrendingDown size={14} className="text-red-400" /> : null}
                    last week {d.prev_score.toFixed(1)}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {d.days_reviewed} days · {d.calls_count} calls · {d.confirmed_count} confirmed · upsell {d.upsell_attempted}/{d.reached_count}
                </span>
              </>
            ) : (
              <span className="text-xs text-amber-300">{d.status === "failed" ? `failed: ${d.error ?? "unknown"}` : d.status}</span>
            )}
          </div>
          {d.status === "done" && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-sm text-gray-300 leading-relaxed">{d.summary}</p>
                {d.wins.length > 0 && (
                  <ul className="space-y-1">
                    {d.wins.map((w, i) => (
                      <li key={i} className="text-sm text-green-200 flex gap-2">
                        <span>✓</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-3">
                {d.coaching.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Coach this week</p>
                    <ul className="space-y-1.5">
                      {d.coaching.map((c, i) => (
                        <li key={i} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-purple-400 mt-0.5">▸</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.training_clips.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Replay together</p>
                    <ul className="space-y-1.5">
                      {d.training_clips.map((clip, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenDay(clip.date)}
                            className="font-mono text-xs text-blue-300 hover:text-white border border-blue-900/60 hover:border-blue-500 rounded px-1.5 py-0.5 cursor-pointer whitespace-nowrap"
                            title="Open that day's scorecard, then click the moment to play it"
                          >
                            {new Date(`${clip.date}T00:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })} {clip.at.slice(0, 5)}
                          </button>
                          <span>{clip.note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.va_message && (
                  <details>
                    <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer">What the VA reads</summary>
                    <p className="text-sm text-gray-400 mt-2 leading-relaxed whitespace-pre-line">{d.va_message}</p>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
