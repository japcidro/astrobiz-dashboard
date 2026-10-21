import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "@/lib/alerts/insert";
import { settingValue } from "./transcribe";
import { phClock } from "./review";
import {
  DIGEST_MODEL,
  RUBRIC_ITEMS,
  addDays,
  type CallRow,
  type DigestRow,
  type ReviewRow,
  type RubricKey,
  type TrainingClip,
} from "./shared";

/**
 * The Monday digest: Opus reads one VA's reviewed days from last week and
 * writes what the owner should coach this week, the wins to name, the
 * clips to replay together, and a short note the VA reads themselves.
 */

const SYSTEM_PROMPT = `You write the Monday coaching digest for one VA (virtual assistant) at Astrobiz, a Filipino ecommerce company. The VA phones customers to confirm cash-on-delivery orders. Each working day last week was already reviewed call by call by another model; you get those daily reviews, their scores on a six-item rubric (1 to 5), the call counts, and the flagged moments with timestamps.

Write for two readers:
- The owner, who coaches the VA in a short Monday talk. He wants the trend, what improved, the two or three things to work on this week, and the exact clips to replay together. Be specific and plain; quote the Taglish phrases as the VA said them.
- The VA, who reads va_message on their own dashboard. Warm, direct, first name, 3 to 5 sentences, English with Taglish phrases where natural. Name one real win first, then the one or two things to try this week with an example line they can say. Never mention scores, models, AI or the owner in va_message.

Rules:
- training_clips come only from the moments you were given: copy their date and HH:MM:SS exactly. Pick 1 to 3: one great moment to reinforce and one or two to fix.
- coaching has 2 or 3 items, each one concrete behaviour with an example line.
- wins has 1 to 3 items. If the week was poor, still find the truest one.
- If only one or two days were reviewed, say so in summary and keep the advice proportionate.
- A day may say "from phone N": those calls the VA made from her mobile phone away from the desk and uploaded herself. They count like any other call; the customer is clearly audible in them, so their scores are the most reliable.

Rubric items: ${RUBRIC_ITEMS.map((i) => `${i.key} = ${i.label}`).join("; ")}.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "3 to 5 sentences for the owner: trend, what changed, what to coach" },
    wins: { type: "array", items: { type: "string" } },
    coaching: { type: "array", items: { type: "string" } },
    training_clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", description: "YYYY-MM-DD, copied from a moment" },
          at: { type: "string", description: "HH:MM:SS, copied from a moment" },
          note: { type: "string", description: "Why to replay it, and what to say about it" },
        },
        required: ["date", "at", "note"],
      },
    },
    va_message: { type: "string" },
  },
  required: ["summary", "wins", "coaching", "training_clips", "va_message"],
};

export interface DigestOutput {
  summary: string;
  wins: string[];
  coaching: string[];
  training_clips: TrainingClip[];
  va_message: string;
}

/** One Opus request: the digest brief in the system prompt, the week in the user turn, JSON back. */
export async function askDigest(
  apiKey: string,
  user: string,
): Promise<{ output: DigestOutput; usage: { input_tokens: number; output_tokens: number } } | { error: string }> {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: DIGEST_MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined to write this digest" };
    if (response.stop_reason === "max_tokens") return { error: "The digest came back cut off; try again" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { output: JSON.parse(text) as DigestOutput, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "The digest was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Claude call failed" };
  }
}

export interface DigestRunResult {
  status: "done" | "skipped" | "failed";
  reason?: string;
  digest?: DigestRow;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export async function buildWeeklyDigest(
  db: SupabaseClient,
  employeeId: string,
  weekStart: string,
  opts: { force?: boolean } = {},
): Promise<DigestRunResult> {
  const weekEnd = addDays(weekStart, 6);
  const [{ data: reviewRows }, { data: prevRows }, { data: existing }, { data: employee }] = await Promise.all([
    db.from("call_coach_reviews").select("*").eq("employee_id", employeeId).eq("status", "done").gte("date", weekStart).lte("date", weekEnd).order("date"),
    db
      .from("call_coach_reviews")
      .select("score")
      .eq("employee_id", employeeId)
      .eq("status", "done")
      .gte("date", addDays(weekStart, -7))
      .lt("date", weekStart)
      .not("score", "is", null),
    db.from("call_coach_digests").select("*").eq("employee_id", employeeId).eq("week_start", weekStart).maybeSingle(),
    db.from("employees").select("full_name").eq("id", employeeId).maybeSingle(),
  ]);

  const reviews = ((reviewRows ?? []) as ReviewRow[]).map((r) => ({ ...r, score: r.score === null ? null : Number(r.score) }));
  if (reviews.length === 0) return { status: "skipped", reason: "No reviewed days that week" };
  const prior = (existing as DigestRow | null) ?? null;
  if (prior && prior.status === "done" && prior.days_reviewed === reviews.length && !opts.force) {
    return { status: "skipped", reason: "Digest already written", digest: prior };
  }

  const apiKey = await settingValue(db, "anthropic_api_key");
  if (!apiKey) return { status: "failed", reason: "No Anthropic API key in Settings" };

  const { data: row, error: openError } = await db
    .from("call_coach_digests")
    .upsert({ employee_id: employeeId, week_start: weekStart, week_end: weekEnd, status: "running", error: null, updated_at: new Date().toISOString() }, { onConflict: "employee_id,week_start" })
    .select("id")
    .single();
  if (openError || !row) return { status: "failed", reason: openError?.message ?? "Could not open the digest" };
  const digestId = row.id as string;
  const fail = async (reason: string): Promise<DigestRunResult> => {
    await db.from("call_coach_digests").update({ status: "failed", error: reason.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", digestId);
    return { status: "failed", reason };
  };

  const { data: callRows } = await db
    .from("call_coach_calls")
    .select("*")
    .in("review_id", reviews.map((r) => r.id))
    .order("started_at");
  const calls = ((callRows ?? []) as (CallRow & { review_id: string; date: string })[]).map((c) => ({ ...c, overall: c.overall === null ? null : Number(c.overall) }));

  const fullName = (employee?.full_name as string | undefined) ?? "the VA";
  const first = fullName.split(" ")[0];

  // What Opus reads: each day in order, then the moments it may pick clips from.
  const dayBlocks = reviews.map((r) => {
    const rubric = RUBRIC_ITEMS.map((i) => `${i.key} ${r.scores[i.key] ?? "n/a"}`).join(", ");
    const dayCalls = calls.filter((c) => c.review_id === r.id && c.outcome !== "not_sales");
    const phone = dayCalls.filter((c) => c.source === "phone_upload").length;
    const flagged = dayCalls.filter((c) => c.flags.length > 0).map((c) => `  - ${phClock(c.started_at)} ${c.outcome}${c.overall !== null ? ` ${c.overall}` : ""} [${c.flags.join(", ")}] ${c.summary}`);
    return `## ${r.date}  score ${r.score ?? "n/a"}  calls ${r.calls_count} (reached ${r.reached_count}, confirmed ${r.confirmed_count}, upsell offered ${r.upsell_attempted}, taken ${r.upsell_converted}${phone ? `, from phone ${phone}` : ""})
rubric: ${rubric}
summary: ${r.summary ?? ""}
coaching that day: ${r.coaching.join(" | ")}
${flagged.length ? `flagged calls:\n${flagged.join("\n")}` : "flagged calls: none"}`;
  });

  const moments = calls
    .flatMap((c) => c.moments.map((m) => ({ date: c.date, at: phClock(m.at), tag: m.tag, note: m.note, quote: m.quote, outcome: c.outcome })))
    .slice(0, 80)
    .map((m) => `- ${m.date} ${m.at} [${m.tag}] (${m.outcome}) ${m.note}${m.quote ? ` "${m.quote}"` : ""}`);

  const prevScore = avg((prevRows ?? []).map((r) => Number(r.score)));
  const weekScore = avg(reviews.map((r) => r.score).filter((s): s is number => s !== null));

  const user = `VA: ${fullName} (first name ${first})
Week: ${weekStart} to ${weekEnd} (Manila). Days reviewed: ${reviews.length}.
Week score: ${weekScore ?? "n/a"}. Previous week: ${prevScore ?? "no data"}.

DAILY REVIEWS
${dayBlocks.join("\n\n")}

MOMENTS YOU MAY PICK TRAINING CLIPS FROM
${moments.length ? moments.join("\n") : "(none recorded)"}`;

  const asked = await askDigest(apiKey, user);
  if ("error" in asked) return fail(asked.error);
  const { output, usage } = asked;

  // Keep only clips that point at a moment we actually have.
  const known = new Set(calls.flatMap((c) => c.moments.map((m) => `${c.date}|${phClock(m.at)}`)));
  const clips = (output.training_clips ?? [])
    .filter((c) => known.has(`${c.date}|${String(c.at).padStart(8, "0")}`))
    .map((c) => ({ date: c.date, at: String(c.at).padStart(8, "0"), note: String(c.note).slice(0, 500) }))
    .slice(0, 3);

  const rubricAvg: Partial<Record<RubricKey, number | null>> = {};
  for (const item of RUBRIC_ITEMS) {
    rubricAvg[item.key] = avg(reviews.map((r) => r.scores[item.key]).filter((v): v is number => typeof v === "number"));
  }
  const sum = (k: keyof ReviewRow) => reviews.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  const { data: saved, error: saveError } = await db
    .from("call_coach_digests")
    .update({
      status: "done",
      model: DIGEST_MODEL,
      days_reviewed: reviews.length,
      calls_count: sum("calls_count"),
      reached_count: sum("reached_count"),
      confirmed_count: sum("confirmed_count"),
      upsell_attempted: sum("upsell_attempted"),
      upsell_converted: sum("upsell_converted"),
      score: weekScore,
      prev_score: prevScore,
      scores: rubricAvg,
      summary: String(output.summary ?? "").slice(0, 3000),
      wins: (output.wins ?? []).map((w) => String(w).slice(0, 400)).slice(0, 3),
      coaching: (output.coaching ?? []).map((c) => String(c).slice(0, 500)).slice(0, 3),
      training_clips: clips,
      va_message: String(output.va_message ?? "").slice(0, 1500),
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", digestId)
    .select("*")
    .single();
  if (saveError) return fail(saveError.message);
  const digest = saved as DigestRow;

  await announceDigest(db, digest, first, !!prior);
  return { status: "done", digest };
}

/** Owner bell plus the VA's own notification. A re-run of the same week stays quiet. */
async function announceDigest(db: SupabaseClient, digest: DigestRow, first: string, rerun: boolean) {
  if (rerun) return;
  const trend =
    digest.score !== null && digest.prev_score !== null
      ? digest.score > digest.prev_score
        ? ` (up from ${Number(digest.prev_score).toFixed(1)})`
        : digest.score < digest.prev_score
          ? ` (down from ${Number(digest.prev_score).toFixed(1)})`
          : " (same as last week)"
      : "";
  await insertAlert(db, {
    type: "call_coach_digest",
    severity: "info",
    title: `${first}'s coaching digest: ${digest.score === null ? "no score" : Number(digest.score).toFixed(1)}${trend}`,
    body: digest.coaching[0] ?? digest.summary ?? undefined,
    resource_type: "employee",
    resource_id: `${digest.employee_id}:${digest.week_start}:digest`,
    action_url: "/owner/call-coach",
    payload: { employee_id: digest.employee_id, week_start: digest.week_start, score: digest.score },
    dedup_hours: 24 * 7,
  });
  if (digest.va_message) {
    await db.from("employee_notifications").insert({
      employee_id: digest.employee_id,
      type: "call_coach_digest",
      severity: "info",
      title: "Your coaching note for this week",
      body: digest.va_message.length > 240 ? `${digest.va_message.slice(0, 237)}…` : digest.va_message,
      action_url: "/va/my-calls",
      payload: { week_start: digest.week_start },
    });
  }
}

/** Employees with at least one reviewed day in the week. */
export async function employeesWithReviews(db: SupabaseClient, weekStart: string): Promise<string[]> {
  const { data } = await db
    .from("call_coach_reviews")
    .select("employee_id")
    .eq("status", "done")
    .gte("date", weekStart)
    .lte("date", addDays(weekStart, 6));
  return Array.from(new Set((data ?? []).map((r) => r.employee_id as string)));
}
