import type { SupabaseClient } from "@supabase/supabase-js";
import { REVIEWER_MODEL, WRITER_MODEL, askJson, isError } from "./claude";
import type { Plan, ReferenceSource, Review, ScriptBeat, ScriptRow, Study } from "./types";
import { MAX_VERSIONS } from "./types";

/**
 * The "adapt a script" skill: decode what won in the reference, map every
 * beat onto our brand, write N versions, review each one. The reference's
 * structure, language and length win; only what is theirs gets replaced.
 */

const UUID = /^[0-9a-f-]{36}$/;
const MAX_SCRIPT_CHARS = 12000;

const STUDY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["study", "plan"],
  properties: {
    study: {
      type: "object",
      additionalProperties: false,
      required: ["angle", "hook_move", "language", "tone", "structure", "why_it_works", "theirs_to_replace"],
      properties: {
        angle: { type: "string", description: "One sentence: the promise and the move the ad makes" },
        hook_move: { type: "string", description: "What the first 3 seconds do and why it stops the scroll" },
        language: { type: "string", description: 'e.g. "Taglish, Tagalog-leaning", "English", "Tagalog"' },
        tone: { type: "string" },
        structure: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "range", "summary"],
            properties: {
              role: { type: "string", description: "Hook, Reframe, Cause, Validation, Product, Proof, Timeline, Offer, CTA, or the fitting word" },
              range: { type: "string", description: 'Timestamps when the script has them, e.g. "0:00-0:04", else ""' },
              summary: { type: "string" },
            },
          },
        },
        why_it_works: { type: "string" },
        theirs_to_replace: { type: "array", items: { type: "string" } },
      },
    },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["beats", "kept", "added_from_dna", "target_seconds"],
      properties: {
        beats: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "theirs", "ours"],
            properties: {
              role: { type: "string" },
              theirs: { type: "string", description: "The reference's actual lines for this beat, quoted or tightly summarized" },
              ours: { type: "string", description: "The finished line or lines we will say, in the right language" },
            },
          },
        },
        kept: { type: "array", items: { type: "string" } },
        added_from_dna: { type: "array", items: { type: "string" } },
        target_seconds: { type: "number" },
      },
    },
  },
} as const;

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "beats", "cta", "seconds"],
  properties: {
    title: { type: "string", description: "3 to 6 words naming this version, in English" },
    hook: { type: "string", description: "The first spoken line or lines, what is said in the first 3 seconds" },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "line", "on_screen", "visual"],
        properties: {
          t: { type: "string", description: 'Time range like "0:00-0:04"' },
          line: { type: "string", description: "Exactly what is said in this beat" },
          on_screen: { type: "string", description: 'Caption or on-screen text, or ""' },
          visual: { type: "string", description: "What we see, one short sentence" },
        },
      },
    },
    cta: { type: "string" },
    seconds: { type: "number" },
  },
} as const;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "fixable", "hook", "structure", "language", "compliance", "brand", "notes"],
  properties: {
    ok: { type: "boolean" },
    fixable: { type: "boolean" },
    hook: { type: "number" },
    structure: { type: "number" },
    language: { type: "number" },
    compliance: { type: "number" },
    brand: { type: "number" },
    notes: { type: "string" },
  },
} as const;

const STUDY_SYSTEM = `You are a senior direct-response video scriptwriter for Philippine DTC brands. A marketer gives you the script of a competitor's winning video ad. Decode why it won, then map it beat by beat onto our brand, so our version wins the same way.

Rules:
- Keep what won: the hook move, the order of the beats, the number of beats, the pacing and length of each beat, the tone, the emotional arc, the device (a confession, an expert pointing at a head, an update, a question). Our version has the same structure as the reference, because that structure is what won.
- Keep the language mix. If the reference is Taglish, ours is Taglish with the same ratio, Tagalog landing where it lands in the reference (feelings, the story) and English where it lands (science, product names, the offer). If the reference is English, ours is English. If Tagalog, Tagalog. Manila-natural, speakable out loud.
- Replace everything that is theirs: their product, brand, category, mechanism, ingredients, claims, numbers, prices, offers, people's names, places, their testimonial details. Ours comes only from the brand profile and the Winning DNA. Never invent a fact, a number, a study, a price or a result.
- When the reference has a beat our brand cannot honestly fill (a demo of their device, a doctor's endorsement, a claim we may not make), swap in the closest beat from the Winning DNA that plays the same role in the same slot; do not drop the beat and do not reorder.
- The Winning DNA is what has already sold for our brand. Use it to fill what the reference cannot give us: our mechanism, our proof timeline, our CTA and offer wording, the compliance phrasing. Do not force the DNA's own spine onto the reference; the reference's structure wins.
- Compliance: a food supplement. Never cure, block, reverse, treat, heal, guaranteed results; say supports, helps, promotes, helps maintain. No doctor or dermatologist claims unless the brand profile allows them. No competitor's brand or product name in our lines.
- The marketer's notes win over everything above.
- The reference may carry timestamps and [ON-SCREEN: ...] markers; read them as information about pacing and captions.

Answer with JSON only, in the given shape. plan.beats has exactly one entry per study.structure entry, in the same order. plan.target_seconds is the reference's length: from its timestamps when it has them, otherwise about 2.4 spoken words per second.`;

const WRITE_SYSTEM = `You write the finished video ad script from a plan, for a Philippine DTC brand. One person speaking to one viewer, written to be said out loud.

Rules:
- One beat per plan beat, in the plan's order. Say the plan's "ours" lines; you may polish the wording so it flows, never the facts.
- Same language mix as the reference (the plan says which), Manila-natural; no stiff translations.
- Total length within 15% of target_seconds at about 2.4 spoken words per second; each beat's share of the time matches the reference's.
- on_screen: the caption for the beat when the reference used captions at that point, else the key phrase of the line, short, or "" when nothing should be on screen.
- visual: what we see, in one short sentence, in English, written for an editor: who, where, what the hands do, product in frame or not.
- Nothing of the competitor's: no brand, product, mechanism, claim, name. No facts beyond the brand profile. Compliance wording: supports / helps / promotes; never cure, block, reverse, treat, guaranteed.
- hook is the first beat's spoken words. cta is the closing ask, as spoken. seconds is your estimate of the whole script.

Answer with JSON only.`;

const REVIEW_SYSTEM = `You are the creative director reviewing an adapted video ad script before it goes to the editor. The script adapts a competitor's winning reference for our brand: it must keep what won in the reference (its hook move, beat order, length, language mix, tone) and keep nothing that is theirs.

Score 0-10, strict:
- "hook": stops the scroll, keeps the reference's hook move, names our product early or earns the wait; 5 or less when it is weaker than the reference's opening.
- "structure": the same beats in the same order with about the same length as the reference (within 15%); nothing of the competitor's left in: product, brand, category words, mechanism, claims, names, offers.
- "language": the same mix as the reference, natural Manila Taglish or English, speakable out loud, no stiff translation, Tagalog and English landing where the reference lands them.
- "compliance": food supplement rules: no cure, block, reverse, treat, heal, guaranteed results; no doctor or dermatologist claims unless the profile allows; no invented studies or percentages; uses supports / helps / promotes.
- "brand": every fact matches the brand profile and the marketer's standing brief (product name, what it is, count, dose, price, offer, guarantee, ingredients, social proof); nothing invented; the brief's rules are followed.
ok is false when: anything of the competitor's remains; a fact or number is invented or wrong; a forbidden claim appears; the language mix differs from the reference; structure is under 6; hook is under 5; compliance is under 8. fixable is true when a rewrite with a note would fix it (wording, a fact, a claim, a missing beat), false when the whole adaptation is off.
"notes": one or two short sentences, the most important fix first; or "Looks great." followed by one useful observation. Plain words, no scores inside the notes.

Answer with JSON only.`;

const VARIANT = [
  "Version 1, the closest adaptation: say the plan's lines nearly verbatim, polished only so they flow.",
  "Version 2, same beats and facts: rewrite the hook and the body in fresher words of your own, keep every beat's role, length and language mix.",
  "Version 3, same beats and facts: a more urgent delivery, blunter, shorter sentences, the same length overall.",
  "Version 4, same beats and facts: a touch more story in the opening beat and the proof beat, the same length overall.",
];

export interface BrandContext {
  store: string;
  profile: string;
  rules: string;
  dna: string;
  /** The marketer's standing brief for the brand: read first, wins over everything but the run's notes. */
  brief: string;
}

function facts(ctx: BrandContext, notes: string): string {
  return [
    ctx.brief.trim() ? `The marketer's standing brief for ${ctx.store} (follow it in every script; only the notes below can override it):\n${ctx.brief.trim()}` : "",
    `Brand profile for ${ctx.store}:\n${ctx.profile.trim() || "(no profile yet; say nothing about the product beyond its name)"}`,
    ctx.rules.trim() ? `Brand rules: ${ctx.rules.trim()}` : "",
    ctx.dna.trim() ? `Winning DNA for ${ctx.store} (what has already sold; its WHAT IS WINNING NOW section is the first place to fill a gap; never use it to reorder the reference):\n${ctx.dna.trim()}` : "No Winning DNA brief for this brand yet.",
    notes.trim() ? `The marketer's notes, which win over everything else: ${notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Step 1 + 2: what won in the reference, and their line → our line for every beat. */
export async function studyAndMap(db: SupabaseClient, input: { script: string; ctx: BrandContext; notes: string }): Promise<{ study: Study; plan: Plan } | { error: string }> {
  const out = await askJson<{ study: Study; plan: Plan }>(db, {
    model: WRITER_MODEL,
    system: STUDY_SYSTEM,
    user: `${facts(input.ctx, input.notes)}\n\nThe reference ad's script:\n"""\n${input.script.trim().slice(0, MAX_SCRIPT_CHARS)}\n"""\n\nAnswer with JSON only.`,
    schema: STUDY_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16000,
    effort: "high",
  });
  if (isError(out)) return out;
  if (!out.study?.structure?.length || !out.plan?.beats?.length) return { error: "Claude could not read a structure out of that script" };
  const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
  const study: Study = {
    angle: clip(out.study.angle, 400),
    hook_move: clip(out.study.hook_move, 500),
    language: clip(out.study.language, 80),
    tone: clip(out.study.tone, 200),
    structure: out.study.structure.slice(0, 24).map((b) => ({ role: clip(b.role, 40), range: clip(b.range, 24), summary: clip(b.summary, 400) })),
    why_it_works: clip(out.study.why_it_works, 800),
    theirs_to_replace: (out.study.theirs_to_replace ?? []).slice(0, 20).map((s) => clip(s, 200)),
  };
  const plan: Plan = {
    beats: out.plan.beats.slice(0, 24).map((b) => ({ role: clip(b.role, 40), theirs: clip(b.theirs, 800), ours: clip(b.ours, 1200) })),
    kept: (out.plan.kept ?? []).slice(0, 12).map((s) => clip(s, 200)),
    added_from_dna: (out.plan.added_from_dna ?? []).slice(0, 12).map((s) => clip(s, 200)),
    target_seconds: Math.max(10, Math.min(600, Math.round(Number(out.plan.target_seconds) || wordsToSeconds(input.script)))),
  };
  return { study, plan };
}

const wordsToSeconds = (text: string) => Math.round(text.trim().split(/\s+/).filter(Boolean).length / 2.4);

export interface WrittenScript {
  title: string;
  hook: string;
  beats: ScriptBeat[];
  cta: string;
  seconds: number;
  script_text: string;
}

/** Step 3: one finished version from the plan. `fix` is the reviewer's or the marketer's note for a rewrite. */
export async function writeVersion(
  db: SupabaseClient,
  input: { study: Study; plan: Plan; ctx: BrandContext; notes: string; variant: number; fix?: string; previous?: string }
): Promise<WrittenScript | { error: string }> {
  const user = [
    facts(input.ctx, input.notes),
    `The reference's language: ${input.study.language}. Tone: ${input.study.tone}. Hook move: ${input.study.hook_move}. Target length: ${input.plan.target_seconds} seconds.`,
    `The plan, beat by beat (role · the reference's lines → our lines):\n${input.plan.beats.map((b, i) => `${i + 1}. ${b.role}\n   theirs: ${b.theirs}\n   ours: ${b.ours}`).join("\n")}`,
    VARIANT[(input.variant - 1 + VARIANT.length) % VARIANT.length],
    input.previous ? `The previous draft:\n"""\n${input.previous.slice(0, 6000)}\n"""` : "",
    input.fix ? `Rewrite it with this fix, keeping everything else: ${input.fix.trim()}` : "",
    "Answer with JSON only.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const out = await askJson<Omit<WrittenScript, "script_text">>(db, { model: WRITER_MODEL, system: WRITE_SYSTEM, user, schema: SCRIPT_SCHEMA as unknown as Record<string, unknown>, maxTokens: 12000, effort: "medium" });
  if (isError(out)) return out;
  const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
  const beats: ScriptBeat[] = (out.beats ?? []).slice(0, 30).map((b) => ({ t: clip(b.t, 20), line: clip(b.line, 1500), on_screen: clip(b.on_screen, 300), visual: clip(b.visual, 400) })).filter((b) => b.line);
  if (beats.length === 0) return { error: "Claude wrote an empty script" };
  const title = clip(out.title, 80) || `Version ${input.variant}`;
  const hook = clip(out.hook, 600) || beats[0].line;
  const cta = clip(out.cta, 400);
  const seconds = Math.max(5, Math.round(Number(out.seconds) || wordsToSeconds(beats.map((b) => b.line).join(" "))));
  return { title, hook, beats, cta, seconds, script_text: scriptText(title, beats) };
}

/** The whole script as the editor reads it: spoken line, then captions and visuals in brackets. */
export function scriptText(title: string, beats: ScriptBeat[]): string {
  return [title.toUpperCase(), "", ...beats.flatMap((b) => [`[${b.t || "·"}] ${b.line}`, ...(b.on_screen ? [`    ON SCREEN: ${b.on_screen}`] : []), ...(b.visual ? [`    VISUAL: ${b.visual}`] : []), ""])].join("\n").trim();
}

/** Step 4: the review, with scores. Strict about anything left of the competitor's and about invented facts. */
export async function reviewScript(db: SupabaseClient, input: { reference: string; study: Study; ctx: BrandContext; script: WrittenScript | ScriptRow }): Promise<Review | null> {
  const out = await askJson<{ ok: boolean; fixable: boolean; hook: number; structure: number; language: number; compliance: number; brand: number; notes: string }>(db, {
    model: REVIEWER_MODEL,
    system: REVIEW_SYSTEM,
    user: [
      input.ctx.brief.trim() ? `The marketer's standing brief for ${input.ctx.store}, which the script must follow: ${input.ctx.brief.trim()}` : "",
      `Brand profile for ${input.ctx.store}:\n${input.ctx.profile.trim() || "(none)"}`,
      input.ctx.rules.trim() ? `Brand rules: ${input.ctx.rules.trim()}` : "",
      input.ctx.dna.trim() ? `What is winning now for the brand (from its Winning DNA; a script that ignores it when the reference left a gap loses structure points):\n${input.ctx.dna.trim().slice(0, 3000)}` : "",
      `What won in the reference: ${input.study.angle} Hook move: ${input.study.hook_move} Language: ${input.study.language}. Beats: ${input.study.structure.map((b) => b.role).join(" → ")}.`,
      `The reference script:\n"""\n${input.reference.trim().slice(0, 8000)}\n"""`,
      `OUR ADAPTED SCRIPT (${input.script.seconds ?? "?"} s):\n"""\n${input.script.script_text.slice(0, 8000)}\n"""`,
      "Answer with JSON only.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
    effort: "medium",
  });
  if (isError(out) || typeof out.ok !== "boolean") return null;
  const n = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
  return { ok: out.ok, fixable: out.fixable !== false, scores: { hook: n(out.hook), structure: n(out.structure), language: n(out.language), compliance: n(out.compliance), brand: n(out.brand) }, notes: String(out.notes ?? "").trim().slice(0, 400) };
}

export async function brandContext(db: SupabaseClient, store: string): Promise<BrandContext> {
  const [{ data: kit }, { data: dna }] = await Promise.all([
    db.from("remake_brand_kits").select("rules, profile").eq("store", store).maybeSingle(),
    db.from("script_brand_dna").select("dna, built_at, marketer_brief").eq("store", store).maybeSingle(),
  ]);
  return { store, profile: (kit?.profile as string | undefined) ?? "", rules: (kit?.rules as string | undefined) ?? "", dna: (dna?.dna as string | undefined) ?? "", brief: (dna?.marketer_brief as string | undefined) ?? "" };
}

export interface AdaptInput {
  item_id: string | null;
  store: string;
  script: string;
  label: string;
  source: ReferenceSource;
  notes: string;
  versions: number;
}

/** The whole skill for one run: save, study + map, write every version. Reviews run afterwards, from the page's polling. */
export async function createAdaptRun(db: SupabaseClient, input: AdaptInput, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  if (!input.store.trim()) return { error: "Pick a brand" };
  const script = input.script.trim();
  if (script.length < 40) return { error: "Paste the reference's script first (at least a few lines)" };
  if (input.item_id && !UUID.test(input.item_id)) return { error: "Bad board card" };
  const versions = Math.min(MAX_VERSIONS, Math.max(1, Math.round(input.versions || 2)));
  const ctx = await brandContext(db, input.store);
  const { data: dnaRow } = await db.from("script_brand_dna").select("built_at").eq("store", input.store).maybeSingle();

  const { data: run, error } = await db
    .from("script_studio_runs")
    .insert({
      item_id: input.item_id,
      store: input.store,
      reference_text: script.slice(0, MAX_SCRIPT_CHARS),
      reference_label: input.label.trim().slice(0, 120),
      reference_source: input.source,
      notes: input.notes.trim().slice(0, 2000),
      versions,
      dna_built_at: (dnaRow?.built_at as string | undefined) ?? null,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !run) return { error: error?.message ?? "Could not save the run" };
  const runId = run.id as string;
  const { data: rows, error: sErr } = await db
    .from("script_studio_scripts")
    .insert(Array.from({ length: versions }, (_, idx) => ({ run_id: runId, idx, status: "writing" })))
    .select("id, idx");
  if (sErr || !rows) return { error: sErr?.message ?? "Could not create the versions" };
  const scripts = rows as Array<{ id: string; idx: number }>;

  const mapped = await studyAndMap(db, { script, ctx, notes: input.notes });
  if (isError(mapped)) {
    await db.from("script_studio_runs").update({ error: mapped.error }).eq("id", runId);
    await db.from("script_studio_scripts").update({ status: "failed", error: mapped.error }).eq("run_id", runId);
    return { error: mapped.error };
  }
  await db.from("script_studio_runs").update({ study: mapped.study, plan: mapped.plan }).eq("id", runId);

  await Promise.all(
    scripts.map(async (s) => {
      const w = await writeVersion(db, { study: mapped.study, plan: mapped.plan, ctx, notes: input.notes, variant: s.idx + 1 });
      if (isError(w)) {
        await db.from("script_studio_scripts").update({ status: "failed", error: w.error }).eq("id", s.id);
        return;
      }
      await db.from("script_studio_scripts").update({ status: "done", title: w.title, hook: w.hook, beats: w.beats, cta: w.cta, seconds: w.seconds, script_text: w.script_text, error: null }).eq("id", s.id);
    })
  );
  return { id: runId };
}

type ScriptWithRun = ScriptRow & { script_studio_runs: { id: string; item_id: string | null; store: string; reference_text: string; notes: string; study: Study | null; plan: Plan | null } };

/** Review finished scripts once; a fixable fail gets one automatic rewrite, which is reviewed again on the next pass. */
export async function runPendingReviews(db: SupabaseClient, runId: string | null): Promise<void> {
  let q = db.from("script_studio_scripts").select("*, script_studio_runs!inner(id, item_id, store, reference_text, notes, study, plan)").eq("status", "done").is("review", null).limit(4);
  if (runId) q = q.eq("run_id", runId);
  const { data } = await q;
  const rows = ((data ?? []) as unknown as ScriptWithRun[]).filter((r) => r.script_studio_runs.study && r.script_studio_runs.plan);
  if (rows.length === 0) return;
  const ctxs = new Map<string, BrandContext>();
  for (const r of rows) if (!ctxs.has(r.script_studio_runs.store)) ctxs.set(r.script_studio_runs.store, await brandContext(db, r.script_studio_runs.store));
  await Promise.all(
    rows.map(async (r) => {
      const { data: locked } = await db.from("script_studio_scripts").update({ review: { checking: true, ok: true, fixable: false, notes: "Reviewing…", scores: { hook: 0, structure: 0, language: 0, compliance: 0, brand: 0 } } }).eq("id", r.id).is("review", null).select("id");
      if (!locked || locked.length === 0) return;
      const run = r.script_studio_runs;
      const ctx = ctxs.get(run.store)!;
      const review = await reviewScript(db, { reference: run.reference_text, study: run.study!, ctx, script: r });
      if (!review) {
        await db.from("script_studio_scripts").update({ review: { ok: true, fixable: false, notes: "Not reviewed: Claude could not read the script.", scores: { hook: 0, structure: 0, language: 0, compliance: 0, brand: 0 } } }).eq("id", r.id);
        return;
      }
      if (!review.ok && review.fixable && (r.attempts ?? 1) < 2) {
        const w = await writeVersion(db, { study: run.study!, plan: run.plan!, ctx, notes: run.notes, variant: r.idx + 1, fix: review.notes, previous: r.script_text });
        if (!isError(w)) {
          await db.from("script_studio_scripts").update({ title: w.title, hook: w.hook, beats: w.beats, cta: w.cta, seconds: w.seconds, script_text: w.script_text, attempts: (r.attempts ?? 1) + 1, review: null }).eq("id", r.id);
          return;
        }
      }
      await db.from("script_studio_scripts").update({ review }).eq("id", r.id);
    })
  );
}

/** The marketer's "rewrite with a note": same plan, new words, reviewed again. */
export async function rewriteScript(db: SupabaseClient, scriptId: string, note: string): Promise<string | null> {
  const { data } = await db.from("script_studio_scripts").select("*, script_studio_runs!inner(id, item_id, store, reference_text, notes, study, plan)").eq("id", scriptId).maybeSingle();
  const r = data as unknown as ScriptWithRun | null;
  if (!r || !r.script_studio_runs.study || !r.script_studio_runs.plan) return "Not found";
  const ctx = await brandContext(db, r.script_studio_runs.store);
  const w = await writeVersion(db, { study: r.script_studio_runs.study, plan: r.script_studio_runs.plan, ctx, notes: r.script_studio_runs.notes, variant: r.idx + 1, fix: note, previous: r.script_text });
  if (isError(w)) return w.error;
  const { error } = await db.from("script_studio_scripts").update({ status: "done", title: w.title, hook: w.hook, beats: w.beats, cta: w.cta, seconds: w.seconds, script_text: w.script_text, attempts: 1, review: null, error: null, kept: false }).eq("id", r.id);
  return error ? error.message : null;
}
