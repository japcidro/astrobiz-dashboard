import type { SupabaseClient } from "@supabase/supabase-js";
import { HOOK_BUCKET, signPaths as signHookPaths } from "@/lib/hook-studio/storage";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { askVision } from "@/lib/remake/vision";
import type { AdaptPlan, Attachment, ReviewScores } from "./types";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * The "adapt an ad" skill, step 1 + 2: read the competitor's static ad like
 * a creative director, then plan our version from the brand profile. One
 * Claude call with the reference image; the answer is the plan the
 * generation prompt is written from.
 */
export async function planAdaptation(
  db: SupabaseClient,
  input: { referenceUrl: string; store: string; profile: string; rules: string; products: Array<{ kind: string | null; description: string | null }>; notes: string; hasModel: boolean }
): Promise<AdaptPlan | null> {
  const system = `You are a senior creative director for direct-response static ads in the Philippines. You adapt a competitor's winning ad for our brand: keep what makes it win (the angle, the structure, the hierarchy, the mood) and replace everything that is theirs (product, brand, claims, prices, people) with ours, using only facts from the brand profile. Never invent prices, claims or numbers. Never keep the competitor's name, product or logo. Keep required compliance lines. Taglish is welcome when the reference is casual. The result must look like a designed ad, not a product photo: strong type hierarchy, one clear message, breathing room, real texture.
Answer with JSON only, exactly this shape:
{"study":{"angle":string,"structure":string,"style":string,"why_it_works":string},
 "plan":{"text":[{"from":string,"to":string}],"final_text":string,"needs_person":boolean,"needs_product":boolean,"design_spec":string}}
- study.structure: the zones top to bottom (e.g. "headline bar top; product in hand center; price badge right; CTA strip bottom").
- plan.text: every text block in the reference mapped to our wording (keep the role: headline stays a headline). Leave out tiny legal print except our compliance line.
- plan.final_text: all the text that will appear on our image, one block per line, in reading order. Exact wording, exact capitalisation.
- plan.needs_person: true only when a human (face, hands, body) is part of the reference's composition.
- plan.design_spec: 150–250 words for an image model: the composition zone by zone, where our product sits and how big (true size: a supplement bottle fits in a hand), the person if any (pose, expression, clothing), background and lighting, palette with hex codes from the brand, typography (weight, case, colour, placement) for each text block quoting the exact words, and a short line on finish (phone-real vs studio). Describe, do not list rules.`;
  const facts = [
    `Brand profile for ${input.store}:\n${input.profile.trim() || "(no profile yet; use only what the product photos show)"}`,
    input.rules.trim() ? `Brand rules: ${input.rules.trim()}` : "",
    input.products.length ? `Product photos available: ${input.products.map((p) => `${p.kind ?? "product"}${p.description ? ` (${p.description})` : ""}`).join("; ")}.` : "No product photos available.",
    input.hasModel ? "A photo of our model is available if a person is needed." : "No model photo is attached; if a person is needed, describe a Filipino man in his 30s.",
    input.notes.trim() ? `The marketer's notes, which win over everything above: ${input.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // Long JSON with a 200-word design spec occasionally comes back malformed; one more try is cheap.
  let out: AdaptPlan | null = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    out = await askVision<AdaptPlan>(db, system, [{ url: input.referenceUrl, label: "The competitor's ad to adapt:" }], `${facts}\n\nAnswer with JSON only, no markdown fences, no line breaks inside strings (use \\n).`, 8000);
    if (out && (!out.study || !out.plan || typeof out.plan.design_spec !== "string")) out = null;
  }
  if (!out) return null;
  return {
    study: {
      angle: String(out.study.angle ?? "").slice(0, 300),
      structure: String(out.study.structure ?? "").slice(0, 400),
      style: String(out.study.style ?? "").slice(0, 400),
      why_it_works: String(out.study.why_it_works ?? "").slice(0, 400),
    },
    plan: {
      text: Array.isArray(out.plan.text) ? out.plan.text.filter((t) => t && typeof t.from === "string" && typeof t.to === "string").slice(0, 20).map((t) => ({ from: t.from.slice(0, 200), to: t.to.slice(0, 200) })) : [],
      final_text: String(out.plan.final_text ?? "").slice(0, 800),
      needs_person: out.plan.needs_person === true,
      needs_product: out.plan.needs_product !== false,
      design_spec: out.plan.design_spec.slice(0, 2500),
    },
  };
}

/** Step 4: score a result against the reference, the plan and the brand; say what to fix. */
export async function reviewAdaptation(
  db: SupabaseClient,
  input: { resultUrl: string; referenceUrl: string | null; productUrls: string[]; finalText: string; profile: string }
): Promise<{ ok: boolean; notes: string; scores: ReviewScores; fixable: boolean } | null> {
  const system = `You are an art director reviewing an AI-generated static ad before it ships. Score 0–10: "design" (hierarchy, readability, balance, polish, does it look like a real ad), "brand" (our product reproduced faithfully with legible correct label text, brand colours, no competitor branding, compliance line present when the bottle label is visible), "structure" (keeps the reference's winning structure and angle). ok=false when any text on the image is garbled, misspelled or different from the planned text, when the product label is wrong or unreadable, when a competitor name or logo appears, when the person is deformed, or when design < 6. "fixable" is true when a regeneration with a note could fix it (text, label, small artefacts), false when the whole concept is off. "notes": one or two short sentences, the most important fix first, or "Looks great." Answer with JSON only: {"ok":boolean,"fixable":boolean,"design":number,"brand":number,"structure":number,"notes":string}.`;
  const images = [{ url: input.resultUrl, label: "IMAGE A — the generated ad to review:" }];
  if (input.referenceUrl) images.push({ url: input.referenceUrl, label: "IMAGE B — the competitor's reference it adapts:" });
  for (const u of input.productUrls.slice(0, 2)) images.push({ url: u, label: "Our product (the label must match this):" });
  const out = await askVision<{ ok?: unknown; fixable?: unknown; design?: unknown; brand?: unknown; structure?: unknown; notes?: unknown }>(
    db,
    system,
    images,
    `Planned text on the image, which must appear exactly:\n${input.finalText || "(no text planned)"}\n\nBrand profile excerpt: ${input.profile.slice(0, 1200)}\n\nAnswer with JSON only.`,
    2000
  );
  if (!out || typeof out.ok !== "boolean") return null;
  const n = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
  return { ok: out.ok, fixable: out.fixable !== false, scores: { design: n(out.design), brand: n(out.brand), structure: n(out.structure) }, notes: typeof out.notes === "string" ? out.notes.slice(0, 300) : "" };
}

/** The generation prompt for one result, written from the plan. */
export function adaptPrompt(plan: AdaptPlan, attachments: Attachment[], rules: string, fix?: string): string {
  const roles = attachments.map((a, n) => {
    const k = n + 1;
    if (a.role === "reference") return `Image ${k} is the competitor's ad: copy its layout, composition, hierarchy and mood exactly; do not copy its product, people, brand name, logo or words.`;
    if (a.role === "product") return `Image ${k} is our product: reproduce it exactly, same bottle, colours and label, every word of the label copied letter for letter and legible, at true size (it fits in a hand).`;
    if (a.role === "model") return `Image ${k} is our model: whenever a person appears, it is this exact individual (same face, hair, skin), never anyone from the reference.`;
    return `Image ${k} is a look reference: style only.`;
  });
  const text = plan.plan.final_text.trim()
    ? `Text on the image, rendered exactly, letter for letter, nothing added or removed: ${plan.plan.final_text.split("\n").map((l) => `"${l.trim().replace(/"/g, "'")}"`).join(" / ")}. Typography as described in the design, crisp and fully legible.`
    : "No text on the image.";
  return [
    plan.plan.design_spec.trim(),
    roles.join(" "),
    text,
    plan.plan.needs_person ? "" : "No person in the image unless the design above asks for hands.",
    "Square 1:1. A finished, designed advertisement: photoreal product and people, clean vector-sharp typography, no watermark, no competitor branding, nothing that looks pasted on.",
    rules.trim() ? `Brand rules: ${rules.trim()}.` : "",
    fix ? `The previous attempt had this problem, fix it this time: ${fix}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface AdaptInput {
  item_id: string | null;
  store: string;
  reference: { bucket: string; path: string; label: string };
  notes: string;
  versions: number;
  model: { bucket: string; path: string; label: string } | null;
  /** Rerun generate + review with a note, keeping an earlier run's plan. */
  change: { run_id: string; note: string } | null;
}

/** Our model for the brand when none was given: the newest person in a folder named like the store, else the newest person. */
async function autoModel(db: SupabaseClient, store: string): Promise<{ bucket: string; path: string; label: string } | null> {
  const { data: folders } = await db.from("remake_people_folders").select("id, name");
  const folder = ((folders ?? []) as Array<{ id: string; name: string }>).find((f) => f.name.trim().toLowerCase() === store.trim().toLowerCase());
  let q = db.from("remake_people").select("bucket, path, name").order("created_at", { ascending: false }).limit(1);
  if (folder) q = q.eq("folder_id", folder.id);
  const { data } = await q;
  const p = (data ?? [])[0] as { bucket: string; path: string; name: string } | undefined;
  return p ? { bucket: p.bucket, path: p.path, label: p.name || `${store} model` } : null;
}

/** Steps 1–3: plan (or reuse a plan on a change), attach, write the prompt, queue the renders. */
export async function createAdaptRun(db: SupabaseClient, input: AdaptInput, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  if (!input.store.trim()) return { error: "Pick a brand" };
  if (!input.reference.path || !/^[\w./-]{3,300}$/.test(input.reference.path) || input.reference.path.includes("..")) return { error: "Pick a reference" };
  if (input.item_id && !UUID.test(input.item_id)) return { error: "Bad board card" };
  const [{ data: kit }, { data: productRows }] = await Promise.all([
    db.from("remake_brand_kits").select("rules, profile").eq("store", input.store).maybeSingle(),
    db.from("remake_brand_images").select("path, kind, description").eq("store", input.store).order("created_at"),
  ]);
  const rules = (kit?.rules as string | undefined) ?? "";
  const profile = (kit?.profile as string | undefined) ?? "";
  const products = ((productRows ?? []) as Array<{ path: string; kind: string | null; description: string | null }>).slice(0, 3);

  let plan: AdaptPlan | null = null;
  let modelPic = input.model;
  if (input.change) {
    const { data: prev } = await db.from("image_studio_runs").select("plan, attachments").eq("id", input.change.run_id).maybeSingle();
    plan = (prev?.plan as AdaptPlan | null) ?? null;
    if (!plan) return { error: "That run has no plan to reuse" };
    const prevModel = ((prev?.attachments as Attachment[]) ?? []).find((a) => a.role === "model");
    if (!modelPic && prevModel) modelPic = { bucket: prevModel.bucket, path: prevModel.path, label: prevModel.label };
    plan = { ...plan, plan: { ...plan.plan, design_spec: `${plan.plan.design_spec} Change requested by the marketer, apply it: ${input.change.note.trim()}` } };
  } else {
    const refSigned = input.reference.bucket === HOOK_BUCKET ? await signHookPaths(db, [input.reference.path]) : await signBoardPaths(db, [input.reference.path]);
    const referenceUrl = refSigned.get(input.reference.path);
    if (!referenceUrl) return { error: "Reference image not found" };
    plan = await planAdaptation(db, { referenceUrl, store: input.store, profile, rules, products, notes: input.notes, hasModel: true });
    if (!plan) return { error: "Claude could not study the reference (is the Anthropic key set?)" };
  }
  if (plan.plan.needs_person && !modelPic) modelPic = await autoModel(db, input.store);
  plan.model_label = modelPic?.label ?? null;

  const attachments: Attachment[] = [
    { bucket: input.reference.bucket, path: input.reference.path, role: "reference", label: input.reference.label.slice(0, 80) },
    ...(plan.plan.needs_product ? products.map((p) => ({ bucket: BOARD_BUCKET, path: p.path, role: "product" as const, label: `${input.store} · ${p.kind ?? "product"}` })) : []),
    ...(plan.plan.needs_person && modelPic ? [{ bucket: modelPic.bucket, path: modelPic.path, role: "model" as const, label: modelPic.label.slice(0, 80) }] : []),
  ];
  const prompt = adaptPrompt(plan, attachments, rules);
  const versions = Math.min(4, Math.max(1, Math.round(input.versions || 1)));

  const { data: run, error } = await db
    .from("image_studio_runs")
    .insert({
      item_id: input.item_id,
      store: input.store,
      preset: "adapt",
      instruction: input.change ? `Change: ${input.change.note.trim().slice(0, 500)}` : input.notes.trim().slice(0, 3000),
      product_mode: plan.plan.needs_product ? "in" : "none",
      person_mode: plan.plan.needs_person ? (modelPic ? "model" : "new") : "none",
      output: "single",
      format: "1:1",
      versions,
      text_on_image: plan.plan.final_text.slice(0, 200),
      text_style: "reference",
      attachments,
      prompt,
      plan,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !run) return { error: error?.message ?? "Could not save the run" };
  const runId = run.id as string;
  const { data: results, error: rErr } = await db
    .from("image_studio_results")
    .insert(Array.from({ length: versions }, (_, idx) => ({ run_id: runId, idx, credits: STILL_CREDITS })))
    .select("id");
  if (rErr || !results) return { error: rErr?.message ?? "Could not create the results" };
  const jobs = (results as Array<{ id: string }>).map((r) => ({
    kind: "image_gen",
    engine: "nano_banana_pro",
    status: "queued",
    params: { run_id: runId, result_id: r.id, prompt, images: attachments.map((a) => ({ bucket: a.bucket, path: a.path })), aspect_ratio: "1:1", split: false },
  }));
  const { data: jobRows, error: jErr } = await db.from("hook_studio_jobs").insert(jobs).select("id, params");
  if (jErr || !jobRows) return { error: jErr?.message ?? "Could not queue the renders" };
  await Promise.all((jobRows as Array<{ id: string; params: { result_id: string } }>).map((j) => db.from("image_studio_results").update({ job_id: j.id }).eq("id", j.params.result_id)));
  return { id: runId };
}

/** One more try for a result the reviewer flagged as fixable: same images, the prompt plus the fix. */
export async function retryResult(db: SupabaseClient, resultId: string, fix: string): Promise<void> {
  const { data } = await db.from("image_studio_results").select("id, run_id, attempts, image_studio_runs!inner(prompt, attachments)").eq("id", resultId).maybeSingle();
  if (!data) return;
  const r = data as unknown as { id: string; run_id: string; attempts: number; image_studio_runs: { prompt: string; attachments: Attachment[] } };
  const prompt = `${r.image_studio_runs.prompt} The previous attempt had this problem, fix it this time: ${fix}`;
  const { data: job } = await db
    .from("hook_studio_jobs")
    .insert({ kind: "image_gen", engine: "nano_banana_pro", status: "queued", params: { run_id: r.run_id, result_id: r.id, prompt, images: r.image_studio_runs.attachments.map((a) => ({ bucket: a.bucket, path: a.path })), aspect_ratio: "1:1", split: false } })
    .select("id")
    .single();
  await db.from("image_studio_results").update({ status: "queued", job_id: (job?.id as string | undefined) ?? null, path: null, preview_path: null, brand_check: null, attempts: (r.attempts ?? 1) + 1, error: null }).eq("id", r.id);
}
