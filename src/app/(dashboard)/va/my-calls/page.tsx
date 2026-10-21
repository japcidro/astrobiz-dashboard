import { redirect } from "next/navigation";
import { Headphones, Smartphone, Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { getEmployee } from "@/lib/supabase/get-employee";
import { createServiceClient } from "@/lib/supabase/service";
import { isRecordedRole } from "@/lib/call-coach/server";
import {
  RUBRIC_ITEMS,
  addDays,
  formatClock,
  phDate,
  scoreTone,
  type CallRow,
  type DigestRow,
  type ReviewRow,
} from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

const OUTCOME: Record<CallRow["outcome"], string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  callback: "Callback",
  no_answer: "No answer",
  wrong_number: "Wrong number",
  not_sales: "Not a sales call",
  unclear: "Unclear",
};

const toneClass = (tone: ReturnType<typeof scoreTone>) =>
  tone === "good" ? "text-green-300" : tone === "mid" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-gray-500";

const longDate = (date: string) =>
  new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" });

/**
 * My Calls: the VA's own scorecard. Their day scores, what the review said,
 * the calls with their summaries, and this week's coaching note. No audio
 * and no transcripts here; those stay with the owner.
 */
export default async function MyCallsPage() {
  const employee = await getEmployee();
  if (!employee) redirect("/login");
  if (!isRecordedRole(employee.role)) redirect("/dashboard");

  const db = createServiceClient();
  const since = addDays(phDate(), -14);
  const [{ data: reviewRows }, { data: digestRows }] = await Promise.all([
    db.from("call_coach_reviews").select("*").eq("employee_id", employee.id).eq("status", "done").gte("date", since).order("date", { ascending: false }),
    db.from("call_coach_digests").select("*").eq("employee_id", employee.id).eq("status", "done").order("week_start", { ascending: false }).limit(1),
  ]);
  const reviews = ((reviewRows ?? []) as ReviewRow[]).map((r) => ({ ...r, score: r.score === null ? null : Number(r.score) }));
  const digest = ((digestRows ?? [])[0] as DigestRow | undefined) ?? null;

  const { data: callRows } = reviews.length
    ? await db
        .from("call_coach_calls")
        .select("id, review_id, position, started_at, ended_at, outcome, scores, overall, summary, upsell_attempted, upsell_converted, flags, source")
        .in("review_id", reviews.map((r) => r.id))
        .order("position")
    : { data: [] };
  const callsByReview = new Map<string, Array<CallRow & { review_id: string }>>();
  for (const c of (callRows ?? []) as Array<CallRow & { review_id: string }>) {
    const list = callsByReview.get(c.review_id) ?? [];
    list.push({ ...c, overall: c.overall === null ? null : Number(c.overall) });
    callsByReview.set(c.review_id, list);
  }

  const first = employee.full_name.split(" ")[0];
  const recent = reviews.slice(0, 7).map((r) => r.score).filter((s): s is number => s !== null);
  const avg = recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Headphones size={24} className="text-purple-400" /> My Calls
          </h1>
          <p className="text-gray-400 mt-1">
            How your customer calls went, {first}. Scores are out of 5 and come from a review of each day&apos;s calls. Use the notes to pick one thing to try
            tomorrow.
          </p>
        </div>
        {/* Calls made from the phone, away from the PC recorder, come in here. */}
        <LinkButton href="/va/my-calls/upload" variant="secondary" size="sm" className="shrink-0">
          <Smartphone size={14} /> Upload from phone
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Your score, last 7 shifts" value={avg === null ? "–" : avg.toFixed(1)} tone={scoreTone(avg)} />
        <Stat label="Calls reviewed, 14 days" value={String(reviews.reduce((a, r) => a + r.calls_count, 0))} />
        <Stat label="Confirmed on the call" value={String(reviews.reduce((a, r) => a + r.confirmed_count, 0))} />
        <Stat
          label="Upsell offered"
          value={(() => {
            const reached = reviews.reduce((a, r) => a + r.reached_count, 0);
            const tried = reviews.reduce((a, r) => a + r.upsell_attempted, 0);
            return reached ? `${Math.round((tried / reached) * 100)}%` : "–";
          })()}
        />
      </div>

      {digest && digest.va_message && (
        <div className="bg-purple-900/20 border border-purple-700/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-purple-300" />
            <h2 className="text-base font-semibold text-white">This week&apos;s coaching note</h2>
            <span className="text-xs text-gray-500 ml-auto">
              week of{" "}
              {new Date(`${digest.week_start}T00:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}
            </span>
          </div>
          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{digest.va_message}</p>
          {digest.wins.length > 0 && (
            <ul className="mt-3 space-y-1">
              {digest.wins.map((w, i) => (
                <li key={i} className="text-sm text-green-200 flex gap-2">
                  <span>✓</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reviews.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-8 text-center text-gray-500 text-sm">
          No reviewed shifts yet. Your first scorecard appears the morning after a recorded shift.
        </div>
      )}

      {reviews.map((r, idx) => {
        const prev = reviews[idx + 1]?.score ?? null;
        const calls = (callsByReview.get(r.id) ?? []).filter((c) => c.outcome !== "not_sales");
        const phoneCalls = calls.filter((c) => c.source === "phone_upload").length;
        return (
          <div key={r.id} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-white">{longDate(r.date)}</h2>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-bold font-mono ${toneClass(scoreTone(r.score))}`}>{r.score === null ? "–" : r.score.toFixed(1)}</span>
                {r.score !== null && prev !== null && (
                  <span className="text-gray-500">
                    {r.score > prev ? <TrendingUp size={16} className="text-green-400" /> : r.score < prev ? <TrendingDown size={16} className="text-red-400" /> : <Minus size={16} />}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {r.calls_count} calls · {r.reached_count} reached · {r.confirmed_count} confirmed · upsell offered on {r.upsell_attempted}
              {r.upsell_converted > 0 && `, taken ${r.upsell_converted}`}
              {phoneCalls > 0 && ` · ${phoneCalls} from phone`}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {RUBRIC_ITEMS.map((item) => {
                const v = r.scores[item.key] ?? null;
                return (
                  <span key={item.key} className="text-xs text-gray-400">
                    {item.label} <span className={`font-mono font-semibold ${toneClass(scoreTone(v))}`}>{v === null ? "n/a" : v.toFixed(1)}</span>
                  </span>
                );
              })}
            </div>

            {r.coaching.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {r.coaching.map((c, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-purple-400 mt-0.5">▸</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}

            {calls.length > 0 && (
              <details className="mt-4 group">
                <summary className="text-xs text-gray-400 hover:text-white cursor-pointer select-none">
                  {calls.length} calls · click to see each one
                </summary>
                <ol className="mt-3 space-y-2">
                  {calls.map((c) => (
                    <li key={c.id} className="bg-gray-900/50 border border-gray-700/60 rounded-lg px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="font-mono text-white">{formatClock(c.started_at)}</span>
                        {c.source === "phone_upload" && (
                          <Pill tone="info">
                            <Smartphone size={11} aria-hidden /> phone
                          </Pill>
                        )}
                        <span className="text-gray-400">{OUTCOME[c.outcome] ?? c.outcome}</span>
                        {c.overall !== null && <span className={`font-mono font-semibold ${toneClass(scoreTone(c.overall))}`}>{c.overall.toFixed(1)}</span>}
                        {c.upsell_attempted && <span className="text-gray-400">upsell {c.upsell_converted ? "taken" : "offered"}</span>}
                        {c.flags.includes("great_call") && <span className="text-green-300">great call</span>}
                      </div>
                      <p className="text-sm text-gray-300 mt-1 leading-relaxed">{c.summary}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: ReturnType<typeof scoreTone> }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`text-xl font-bold mt-1 font-mono ${tone ? toneClass(tone) : "text-white"}`}>{value}</p>
    </div>
  );
}
