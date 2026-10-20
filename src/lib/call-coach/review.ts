import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settingValue } from "./transcribe";
import {
  DEFAULT_RUBRIC,
  REVIEW_MODEL,
  RUBRIC_ITEMS,
  RUBRIC_SETTING_KEY,
  type CallOutcome,
  type MicEventRow,
  type ReviewRow,
  type RubricKey,
  type TranscriptTurn,
} from "./shared";

/**
 * Call Coach review: Claude reads one VA's whole day of transcripts, splits
 * it into calls, scores each call against the rubric and writes the day's
 * coaching notes. One request per VA per day; re-run when new minutes land.
 */

const OUTCOMES: CallOutcome[] = ["confirmed", "cancelled", "callback", "no_answer", "wrong_number", "not_sales", "unclear"];
const REACHED: CallOutcome[] = ["confirmed", "cancelled", "callback", "wrong_number"];
const HMS = /^\d{1,2}:\d{2}:\d{2}$/;

interface SegmentWithTranscript {
  id: string;
  started_at: string;
  ended_at: string;
  voice_seconds: number;
  status: string;
  turns: TranscriptTurn[] | null;
}

/** "HH:MM:SS" on the Manila clock. */
export function phClock(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(11, 19);
}

/** The reverse: a PH date plus "HH:MM:SS" back to an ISO instant. */
export function phInstant(date: string, hms: string): string | null {
  if (!HMS.test(hms)) return null;
  const [h, m, s] = hms.split(":").map(Number);
  if (h > 23 || m > 59 || s > 59) return null;
  const d = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const SPEAKER = { va: "VA", customer: "CUSTOMER", other: "OTHER" } as const;

/**
 * The day as one text: every transcribed segment in order with wall-clock
 * timestamps, quiet stretches and mic events between them. Claude works from
 * this, so the format is what the prompt describes.
 */
export function buildTimeline(segments: SegmentWithTranscript[], events: MicEventRow[]): string {
  const lines: string[] = [];
  const evs = events.filter((e) => e.kind !== "silent" && e.kind !== "blocked").sort((a, b) => a.at.localeCompare(b.at));
  let evIdx = 0;
  let prevEnd: string | null = null;

  const flushEvents = (upTo: string | null) => {
    while (evIdx < evs.length && (upTo === null || evs[evIdx].at <= upTo)) {
      const e = evs[evIdx++];
      const label =
        e.kind === "started" ? "recording started" : e.kind === "paused" ? "break started, recording paused" : e.kind === "resumed" ? "back from break, recording resumed" : e.kind === "lost" ? "microphone lost" : "clocked out, recording stopped";
      lines.push(`[${phClock(e.at)}] (${label})`);
    }
  };

  for (const seg of segments) {
    if (!seg.turns) continue;
    flushEvents(seg.started_at);
    if (prevEnd) {
      const gapMin = Math.round((new Date(seg.started_at).getTime() - new Date(prevEnd).getTime()) / 60000);
      if (gapMin >= 2) lines.push(`(quiet for ${gapMin} min)`);
    }
    if (seg.turns.length === 0) {
      lines.push(`[${phClock(seg.started_at)}] (noise, no words)`);
    } else {
      const base = new Date(seg.started_at).getTime();
      for (const turn of seg.turns) {
        lines.push(`[${phClock(new Date(base + turn.t * 1000))}] ${SPEAKER[turn.speaker] ?? "OTHER"}: ${turn.text}`);
      }
    }
    prevEnd = seg.ended_at;
  }
  flushEvents(null);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are the call quality coach for Astrobiz, a Filipino ecommerce company that sells on Shopify and delivers cash-on-delivery through J&T Express. Its VAs (virtual assistants) phone customers to confirm COD orders, answer questions and follow up. You will read one VA's whole shift as a timestamped transcript recorded from their laptop microphone, and turn it into a scorecard the owner uses to coach that VA.

What you are reading:
- Lines look like "[HH:MM:SS] VA: ..." on the Manila clock. CUSTOMER lines exist only when the phone was on loudspeaker; often you only hear the VA's side and must infer the customer from the VA's replies.
- "(quiet for N min)", "(noise, no words)" and mic events separate stretches. Calls are usually 30 seconds to 5 minutes, separated by quiet.
- Taglish is normal. Transcripts have errors; read for meaning.

Your job:
1. Split the day into calls. A call starts with a greeting or dialing talk and ends with a goodbye, a hang-up, or the next greeting. Voicemail, "the number you dialed", and one-sided "hello? hello?" are calls with outcome no_answer. Talking to a teammate, reading orders aloud, or personal talk is one or more not_sales entries; keep those short and do not score them.
2. Score each sales call on the rubric below. Use null for a rubric item the call never reached. Never score what you cannot hear: when the customer is not audible, score the VA's words and say so in the summary rather than guessing the customer's reaction.
3. Pick the moments worth the owner's ear: a mishandled objection, a missed upsell, a great save, wrong information, a tone change. Each moment has the exact HH:MM:SS of the line it refers to and a short quote from the transcript.
4. Write the day summary and 2 to 4 coaching points as you would say them to the VA: specific, kind, actionable, in English with the Taglish phrases quoted as spoken.

Outcomes: confirmed (customer agreed to receive the order), cancelled, callback (customer asked to be called again or will decide later), no_answer (ring-out, voicemail, busy), wrong_number, not_sales (not a customer call), unclear.

Timestamps you return are "HH:MM:SS" strings copied from the transcript. Never invent a time that does not appear in it.

Rubric:
`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { type: "string", description: "HH:MM:SS of the first line of the call" },
          end: { type: "string", description: "HH:MM:SS of the last line of the call" },
          outcome: { type: "string", enum: OUTCOMES },
          customer_audible: { type: "boolean" },
          scores: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(RUBRIC_ITEMS.map((i) => [i.key, { type: ["integer", "null"], description: "1 to 5, or null when not applicable" }])),
            required: RUBRIC_ITEMS.map((i) => i.key),
          },
          summary: { type: "string", description: "One or two sentences: what happened and how the VA did" },
          upsell_attempted: { type: "boolean" },
          upsell_converted: { type: "boolean" },
          flags: { type: "array", items: { type: "string" } },
          moments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                at: { type: "string", description: "HH:MM:SS from the transcript" },
                tag: { type: "string", description: "objection | no_upsell | great | tone | wrong_info | confirmation | other" },
                note: { type: "string" },
                quote: { type: ["string", "null"] },
              },
              required: ["at", "tag", "note", "quote"],
            },
          },
        },
        required: ["start", "end", "outcome", "customer_audible", "scores", "summary", "upsell_attempted", "upsell_converted", "flags", "moments"],
      },
    },
    day_summary: { type: "string" },
    coaching: { type: "array", items: { type: "string" } },
    non_call_notes: { type: ["string", "null"], description: "Anything else the owner should know: long quiet stretches, teammate chatter, mic problems" },
  },
  required: ["calls", "day_summary", "coaching", "non_call_notes"],
};

export interface ReviewOutput {
  calls: Array<{
    start: string;
    end: string;
    outcome: CallOutcome;
    customer_audible: boolean;
    scores: Record<RubricKey, number | null>;
    summary: string;
    upsell_attempted: boolean;
    upsell_converted: boolean;
    flags: string[];
    moments: Array<{ at: string; tag: string; note: string; quote: string | null }>;
  }>;
  day_summary: string;
  coaching: string[];
  non_call_notes: string | null;
}

/** One Claude request: the rubric in the system prompt, the day in the user turn, JSON back. */
export async function askReview(
  apiKey: string,
  rubric: string,
  user: string,
): Promise<{ output: ReviewOutput; usage: { input_tokens: number; output_tokens: number } } | { error: string }> {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT + rubric, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined to review this day" };
    if (response.stop_reason === "max_tokens") return { error: "Claude's review came back cut off; try again" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      output: JSON.parse(text) as ReviewOutput,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    };
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Claude's review was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Claude call failed" };
  }
}

export interface ReviewRunResult {
  status: "done" | "skipped" | "failed";
  reason?: string;
  review?: ReviewRow;
}

export async function loadRubric(db: SupabaseClient): Promise<string> {
  return (await settingValue(db, RUBRIC_SETTING_KEY)) ?? DEFAULT_RUBRIC;
}

export async function reviewDay(
  db: SupabaseClient,
  employeeId: string,
  date: string,
  opts: { force?: boolean } = {},
): Promise<ReviewRunResult> {
  const [{ data: segRows }, { data: existing }] = await Promise.all([
    db
      .from("call_coach_segments")
      .select("id, started_at, ended_at, voice_seconds, status, call_coach_transcripts(turns)")
      .eq("employee_id", employeeId)
      .eq("date", date)
      .order("started_at"),
    db.from("call_coach_reviews").select("*").eq("employee_id", employeeId).eq("date", date).maybeSingle(),
  ]);

  const segments: SegmentWithTranscript[] = ((segRows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const t = r.call_coach_transcripts as { turns?: TranscriptTurn[] } | Array<{ turns?: TranscriptTurn[] }> | null;
    const turns = Array.isArray(t) ? (t[0]?.turns ?? null) : (t?.turns ?? null);
    return {
      id: r.id as string,
      started_at: r.started_at as string,
      ended_at: r.ended_at as string,
      voice_seconds: Number(r.voice_seconds),
      status: r.status as string,
      turns: r.status === "transcribed" || r.status === "scored" ? (turns ?? []) : null,
    };
  });
  const transcribed = segments.filter((s) => s.turns !== null);
  if (transcribed.length === 0) return { status: "skipped", reason: "No transcribed minutes yet" };
  if (!transcribed.some((s) => (s.turns?.length ?? 0) > 0)) return { status: "skipped", reason: "No speech in the transcripts yet" };

  const lastEnded = transcribed[transcribed.length - 1].ended_at;
  const prior = (existing as ReviewRow | null) ?? null;
  if (prior && prior.status === "done" && prior.reviewed_through && prior.reviewed_through >= lastEnded && !opts.force) {
    return { status: "skipped", reason: "Already reviewed", review: prior };
  }

  const apiKey = await settingValue(db, "anthropic_api_key");
  if (!apiKey) return { status: "failed", reason: "No Anthropic API key in Settings" };

  const { data: reviewRow, error: upsertError } = await db
    .from("call_coach_reviews")
    .upsert(
      { employee_id: employeeId, date, status: "running", error: null, updated_at: new Date().toISOString() },
      { onConflict: "employee_id,date" },
    )
    .select("id")
    .single();
  if (upsertError || !reviewRow) return { status: "failed", reason: upsertError?.message ?? "Could not open the review" };
  const reviewId = reviewRow.id as string;

  const fail = async (reason: string): Promise<ReviewRunResult> => {
    await db.from("call_coach_reviews").update({ status: "failed", error: reason.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", reviewId);
    return { status: "failed", reason };
  };

  const [{ data: events }, { data: employee }, { data: stores }, rubric] = await Promise.all([
    db.from("call_coach_mic_events").select("id, kind, at, detail").eq("employee_id", employeeId).eq("date", date).order("at"),
    db.from("employees").select("full_name").eq("id", employeeId).maybeSingle(),
    db.from("shopify_stores").select("name").eq("is_active", true),
    loadRubric(db),
  ]);

  const timeline = buildTimeline(segments, (events ?? []) as MicEventRow[]);
  const storeNames = (stores ?? []).map((s) => s.name as string).join(", ") || "the company's stores";
  const user = `VA: ${(employee?.full_name as string | undefined) ?? "unknown"}
Shift date (Manila): ${date}
Stores they confirm orders for: ${storeNames}
Transcribed minutes: ${transcribed.length}

TRANSCRIPT
${timeline}`;

  const asked = await askReview(apiKey, rubric, user);
  if ("error" in asked) return fail(asked.error);
  const { output, usage } = asked;

  // Calls: keep the ones whose times parse, in order.
  const calls = output.calls
    .map((c) => {
      const started_at = phInstant(date, c.start);
      let ended_at = phInstant(date, c.end);
      if (!started_at) return null;
      if (!ended_at || ended_at < started_at) ended_at = started_at;
      const scores: Partial<Record<RubricKey, number | null>> = {};
      for (const item of RUBRIC_ITEMS) {
        const v = c.scores?.[item.key];
        scores[item.key] = typeof v === "number" && v >= 1 && v <= 5 ? Math.round(v) : null;
      }
      const scored = Object.values(scores).filter((v): v is number => typeof v === "number");
      const overall = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;
      return {
        started_at,
        ended_at,
        outcome: OUTCOMES.includes(c.outcome) ? c.outcome : ("unclear" as CallOutcome),
        customer_audible: !!c.customer_audible,
        scores,
        overall,
        summary: (c.summary ?? "").slice(0, 1000),
        upsell_attempted: !!c.upsell_attempted,
        upsell_converted: !!c.upsell_converted,
        flags: (c.flags ?? []).map((f) => String(f).slice(0, 40)).slice(0, 8),
        moments: (c.moments ?? [])
          .map((m) => ({ at: phInstant(date, m.at), tag: String(m.tag ?? "other").slice(0, 30), note: String(m.note ?? "").slice(0, 500), quote: m.quote ? String(m.quote).slice(0, 300) : null }))
          .filter((m): m is { at: string; tag: string; note: string; quote: string | null } => !!m.at),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));

  const sales = calls.filter((c) => c.outcome !== "not_sales");
  const scoredCalls = sales.filter((c) => c.overall !== null);
  const dayScore = scoredCalls.length ? Math.round((scoredCalls.reduce((a, c) => a + (c.overall ?? 0), 0) / scoredCalls.length) * 10) / 10 : null;
  const rubricAvg: Partial<Record<RubricKey, number | null>> = {};
  for (const item of RUBRIC_ITEMS) {
    const vals = sales.map((c) => c.scores[item.key]).filter((v): v is number => typeof v === "number");
    rubricAvg[item.key] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }

  await db.from("call_coach_calls").delete().eq("review_id", reviewId);
  if (calls.length > 0) {
    const { error: callsError } = await db.from("call_coach_calls").insert(
      calls.map((c, i) => ({ review_id: reviewId, employee_id: employeeId, date, position: i + 1, ...c })),
    );
    if (callsError) return fail(`Saving calls: ${callsError.message}`);
  }

  const update = {
    status: "done",
    model: REVIEW_MODEL,
    segments_count: transcribed.length,
    voice_seconds: Math.round(transcribed.reduce((a, s) => a + s.voice_seconds, 0) * 10) / 10,
    reviewed_through: lastEnded,
    calls_count: sales.length,
    reached_count: sales.filter((c) => REACHED.includes(c.outcome)).length,
    confirmed_count: sales.filter((c) => c.outcome === "confirmed").length,
    upsell_attempted: sales.filter((c) => c.upsell_attempted).length,
    upsell_converted: sales.filter((c) => c.upsell_converted).length,
    score: dayScore,
    scores: rubricAvg,
    summary: (output.day_summary ?? "").slice(0, 3000),
    coaching: (output.coaching ?? []).map((c) => String(c).slice(0, 500)).slice(0, 6),
    non_call_notes: output.non_call_notes ? String(output.non_call_notes).slice(0, 1500) : null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    error: null,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error: saveError } = await db.from("call_coach_reviews").update(update).eq("id", reviewId).select("*").single();
  if (saveError) return fail(saveError.message);

  await db
    .from("call_coach_segments")
    .update({ status: "scored" })
    .in("id", transcribed.map((s) => s.id))
    .eq("status", "transcribed");

  return { status: "done", review: saved as ReviewRow };
}

/** Every recorded employee with transcribed minutes on a date that a done review does not yet cover. */
export async function employeesNeedingReview(db: SupabaseClient, date: string): Promise<string[]> {
  const [{ data: segs }, { data: reviews }] = await Promise.all([
    db.from("call_coach_segments").select("employee_id, ended_at").eq("date", date).in("status", ["transcribed", "scored"]),
    db.from("call_coach_reviews").select("employee_id, status, reviewed_through").eq("date", date),
  ]);
  const latest = new Map<string, string>();
  for (const s of segs ?? []) {
    const id = s.employee_id as string;
    const end = s.ended_at as string;
    if (!latest.has(id) || latest.get(id)! < end) latest.set(id, end);
  }
  const covered = new Map<string, string | null>();
  for (const r of reviews ?? []) if (r.status === "done") covered.set(r.employee_id as string, r.reviewed_through as string | null);
  return Array.from(latest.entries())
    .filter(([id, end]) => !covered.has(id) || (covered.get(id) ?? "") < end)
    .map(([id]) => id);
}
