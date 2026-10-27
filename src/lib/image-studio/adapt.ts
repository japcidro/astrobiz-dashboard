import type { SupabaseClient } from "@supabase/supabase-js";
import { HOOK_BUCKET, signPaths as signHookPaths } from "@/lib/hook-studio/storage";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { askVision } from "@/lib/remake/vision";
import { loadBrandModels } from "@/lib/remake/views";
import { isContents, pickStaticAdPhotos, type AdaptPlan, type Attachment, type ReviewScores } from "./types";

export { isContents };

const UUID = /^[0-9a-f-]{36}$/;

type BrandImageRow = { id: string; path: string; kind: string | null; description: string | null; pack_spec: string | null; ad_use: string | null };

/**
 * An exact description of a packshot, read once by Claude from the photo and
 * cached on the brand image: the container, every colour, every label line.
 * Saved descriptions are short and can be wrong ("gold accents" on a bottle
 * with none), and the image model drifts toward the ad's palette without it.
 */
async function packSpecFor(db: SupabaseClient, img: BrandImageRow, url: string): Promise<string | null> {
  if (img.pack_spec?.trim()) return img.pack_spec;
  const system = `You describe product packaging so an image model can reproduce it exactly. Describe only what you see; never guess or embellish. Answer with JSON only: {"container":string,"colours":string,"label_lines":string[]}.
- container: one sentence: the container type, proportions and cap or lid (e.g. "squat round plastic supplement bottle with a ribbed white screw cap").
- colours: one sentence naming the colour of the body, the cap, the label background and every accent (stripes, icons, logo, text). Name each real colour; do not mention colours that are not there.
- label_lines: every line of text on the front label, top to bottom, exact spelling and capitalisation, one string per line.`;
  const out = await askVision<{ container?: unknown; colours?: unknown; label_lines?: unknown }>(db, system, [{ url, label: "The product packaging:" }], "Answer with JSON only.", 1200);
  if (!out || typeof out.container !== "string" || typeof out.colours !== "string") return null;
  const lines = Array.isArray(out.label_lines) ? out.label_lines.filter((l): l is string => typeof l === "string" && !!l.trim()).slice(0, 14) : [];
  const spec = `${out.container.trim().replace(/\.$/, "")}. ${out.colours.trim().replace(/\.$/, "")}.${lines.length ? ` Front label, top to bottom: ${lines.map((l) => `"${l.trim().replace(/"/g, "'")}"`).join(" / ")}.` : ""}`.slice(0, 900);
  await db.from("remake_brand_images").update({ pack_spec: spec }).eq("id", img.id);
  return spec;
}

/** The pack's lock line for prompts and reviews: what it must look like, whatever the ad's colours. */
const lockLine = (spec: string) => `Our product pack, exactly as in its photo: ${spec} It keeps these exact colours and label whatever the ad's palette: the palette is for the background, panels and type, never for the product. Every pack shown is this same pack.`;

/**
 * The "adapt an ad" skill, step 1 + 2: read the competitor's static ad like
 * a creative director, then plan our version from the brand profile. One
 * Claude call with the reference image; the answer is the plan the
 * generation prompt is written from.
 */
export async function planAdaptation(
  db: SupabaseClient,
  input: {
    referenceUrl: string;
    store: string;
    profile: string;
    rules: string;
    packs: Array<{ url: string; spec: string | null; kind: string | null; description: string | null }>;
    /** A photo of what is inside the pack (patches, capsules…), for designs that show it. */
    contents: { url: string; kind: string | null; description: string | null } | null;
    notes: string;
    /** The brand's models; the planner picks the one who fits the person the ad needs, or none. */
    models: Array<{ url: string; label: string }>;
    /** The one model was asked for by name: use it whenever a person appears. */
    modelForced: boolean;
  }
): Promise<AdaptPlan | null> {
  const system = `You are a senior creative director for direct-response static ads in the Philippines. You adapt a competitor's winning ad for our brand: keep what makes it win (the angle, the structure, the hierarchy, the mood) and replace everything that is theirs (product, brand, claims, prices, people) with ours, using only facts from the brand profile. Never invent prices, claims or numbers. Never keep the competitor's name, product or logo. Keep required compliance lines. Taglish is welcome when the reference is casual. The result must look like a designed ad, not a product photo: strong type hierarchy, one clear message, breathing room, real texture.
Answer with JSON only, exactly this shape:
{"study":{"angle":string,"structure":string,"style":string,"why_it_works":string},
 "plan":{"text":[{"from":string,"to":string}],"final_text":string,"needs_person":boolean,"model":number,"needs_product":boolean,"shows_contents":boolean,"design_spec":string}}
- study.structure: the zones top to bottom (e.g. "headline bar top; product in hand center; price badge right; CTA strip bottom").
- plan.text: every text block in the reference mapped to our wording (keep the role: headline stays a headline). Leave out tiny legal print except our compliance line.
- plan.final_text: all the text that will appear on our image, one block per line, in reading order. Exact wording, exact capitalisation.
- plan.needs_person: true only when a human (face, hands, body) is part of the reference's composition.
- plan.model: when a person is needed and OUR MODEL photos are attached, the number of the one who best fits who the design needs: the same age group, gender and role as the reference's person, adapted to our audience (a girl of about 5 for a little girl; never an adult for a child, never a child for a parent). 0 when none fits, when no model photo is attached, or when no person is needed; then you cast the person yourself.
- plan.shows_contents: true only when what is inside our pack appears outside it in our design (loose capsules or gummies, scattered or in a hand; a patch worn on the skin or held up); label text that mentions it does not count.
- plan.design_spec: 150–250 words for an image model: the composition zone by zone, where our product sits and how big (true size: a supplement bottle fits in a hand) — our pack always shows its FRONT, the side in its photo, facing the camera with the front label readable, big and clear enough that someone scrolling a feed recognises the product at a glance (a hero placement, never a small prop in the background, never its back or side) — the product described exactly as it looks in its photo (its real body, cap and label colours, never colours taken from the ad's palette; the palette is for background, panels and type), the person if any (when model is 0: who they are, with age, gender and look, keeping the reference person's role and age group and matching the brand's audience; when a model is picked, only their pose, expression and clothing, since the face comes from the photo), background and lighting, palette with hex codes from the brand, typography (weight, case, colour, placement) for each text block quoting the exact words, and a short line on finish (phone-real vs studio). Describe, do not list rules.`;
  const facts = [
    `Brand profile for ${input.store}:\n${input.profile.trim() || "(no profile yet; use only what the product photos show)"}`,
    input.rules.trim() ? `Brand rules: ${input.rules.trim()}` : "",
    input.packs.length
      ? `Our product pack, its front (photo attached): ${input.packs.map((p) => p.spec ?? `${p.kind ?? "product"}${p.description ? ` (${p.description})` : ""}`).join(" Also: ")}`
      : "No product photos available.",
    input.contents
      ? `What is inside the pack (photo attached): ${input.contents.kind ?? "the contents"}${input.contents.description ? `, ${input.contents.description}` : ""}. When the design shows it, describe it exactly as in its photo.`
      : "",
    input.models.length
      ? input.modelForced
        ? "The OUR MODEL 1 photo is the person to use: if a person is needed, set model to 1."
        : `${input.models.length === 1 ? "One photo" : `${input.models.length} photos`} of the brand's models ${input.models.length === 1 ? "is" : "are"} attached (OUR MODEL 1${input.models.length > 1 ? `–${input.models.length}` : ""}). If a person is needed, pick the one who fits who the design needs; if none fits, set model to 0 and cast the person yourself.`
      : "No model photos for this brand. If a person is needed, set model to 0 and cast them yourself: the reference person's role and age group (a child stays a child), matched to the audience in the brand profile.",
    input.notes.trim() ? `The marketer's notes, which win over everything above: ${input.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // Long JSON with a 200-word design spec occasionally comes back malformed; one more try is cheap.
  let out: AdaptPlan | null = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    out = await askVision<AdaptPlan>(
      db,
      system,
      [
        { url: input.referenceUrl, label: "The competitor's ad to adapt:" },
        ...input.packs.slice(0, 1).map((p) => ({ url: p.url, label: "OUR product pack, its front, as it really looks:" })),
        ...(input.contents ? [{ url: input.contents.url, label: "What is inside OUR pack, as it really looks:", maxSide: 800 }] : []),
        // Thumbnails are enough to judge age, gender and look.
        ...input.models.map((m, i) => ({ url: m.url, label: `OUR MODEL ${i + 1}${m.label ? ` (${m.label})` : ""}:`, maxSide: 640 })),
      ],
      `${facts}\n\nAnswer with JSON only, no markdown fences, no line breaks inside strings (use \\n).`,
      8000
    );
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
      model_pick: Math.max(0, Math.round(Number((out.plan as { model?: unknown }).model) || 0)),
      needs_product: out.plan.needs_product !== false,
      shows_contents: out.plan.shows_contents === true,
      design_spec: out.plan.design_spec.slice(0, 2500),
    },
  };
}

/** Step 4: score a result against the reference, the plan and the brand; say what to fix. */
export async function reviewAdaptation(
  db: SupabaseClient,
  input: { resultUrl: string; referenceUrl: string | null; productUrls: string[]; productLock: string | null; finalText: string; profile: string; modelUrl?: string | null }
): Promise<{ ok: boolean; notes: string; scores: ReviewScores; fixable: boolean; productOk: boolean | null; productIssue: string; personOk: boolean | null } | null> {
  const system = `You are an art director reviewing an AI-generated static ad before it ships. Score 0–10: "design" (hierarchy, readability, balance, polish, does it look like a real ad), "brand" (our product reproduced faithfully with legible correct label text, brand colours, no competitor branding, compliance line present when the bottle label is visible), "structure" (keeps the reference's winning structure and angle). ok=false when any text on the image is garbled, misspelled or different from the planned text, when the product label is wrong or unreadable, when a competitor name or logo appears, when the person is deformed, or when design < 6. "fixable" is true when a regeneration with a note could fix it (text, label, small artefacts, a wrong product), false when the whole concept is off. "notes": one or two short sentences, the most important fix first, or "Looks great."
Product check, strictest of all because a wrong product wastes the ad: compare EVERY pack in IMAGE A with OUR PRODUCT photo and its description: the container shape, the body colour, the cap colour, the label colour, the stripes and accents, the logo and the label wording. "product_ok" is false if any pack differs in any of these (a body recoloured to match the ad, a different logo or icon, label lines invented, missing or reworded, a different kind of container), or if our product is missing when the ad shows a product, or if our pack is seen only from the back or side, or is so small, cropped or hidden that someone scrolling a feed would not recognise it at a glance. Small text you cannot read at this size is not a difference by itself; a wrong colour or a wrong word you can read is. When product_ok is false, ok is false and fixable is true, and "product_issue" says concretely what differs (e.g. "the bottles are dark green; ours is white with thin teal stripes"). When there is no product photo, product_ok is null.
Person check, when an OUR MODEL photo is given: every person in IMAGE A must be that person (same face, hair, skin tone and age). "person_ok" is false when a person in IMAGE A is the one from IMAGE B or anyone else; then ok is false, fixable is true, and "person_issue" says who appears instead (e.g. "the girl is the reference's girl, not our model"). Without a model photo, person_ok is null.
Answer with JSON only: {"ok":boolean,"fixable":boolean,"design":number,"brand":number,"structure":number,"product_ok":boolean|null,"product_issue":string,"person_ok":boolean|null,"person_issue":string,"notes":string}.`;
  const images: Array<{ url: string; label: string; maxSide?: number }> = [{ url: input.resultUrl, label: "IMAGE A — the generated ad to review:" }];
  if (input.referenceUrl) images.push({ url: input.referenceUrl, label: "IMAGE B — the competitor's reference it adapts:" });
  for (const u of input.productUrls.slice(0, 2)) images.push({ url: u, label: "OUR PRODUCT — every pack in IMAGE A must look exactly like this:" });
  if (input.modelUrl) images.push({ url: input.modelUrl, label: "OUR MODEL — every person in IMAGE A must be this person:", maxSide: 800 });
  const out = await askVision<{ ok?: unknown; fixable?: unknown; design?: unknown; brand?: unknown; structure?: unknown; product_ok?: unknown; product_issue?: unknown; person_ok?: unknown; person_issue?: unknown; notes?: unknown }>(
    db,
    system,
    images,
    `${input.productLock ? `Our product, described: ${input.productLock}\n\n` : ""}Planned text on the image, which must appear exactly:\n${input.finalText || "(no text planned)"}\n\nBrand profile excerpt: ${input.profile.slice(0, 1200)}\n\nAnswer with JSON only.`,
    2000
  );
  if (!out || typeof out.ok !== "boolean") return null;
  const n = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
  const productOk = input.productUrls.length ? (typeof out.product_ok === "boolean" ? out.product_ok : null) : null;
  const productIssue = typeof out.product_issue === "string" ? out.product_issue.trim().slice(0, 300) : "";
  const personOk = input.modelUrl ? (typeof out.person_ok === "boolean" ? out.person_ok : null) : null;
  const personIssue = typeof out.person_issue === "string" ? out.person_issue.trim().slice(0, 300) : "";
  // A wrong product or a wrong person never passes, whatever the other scores say.
  const ok = out.ok && productOk !== false && personOk !== false;
  const notes = typeof out.notes === "string" ? out.notes.slice(0, 300) : "";
  return {
    ok,
    fixable: productOk === false || personOk === false ? true : out.fixable !== false,
    scores: { design: n(out.design), brand: productOk === false ? Math.min(n(out.brand), 4) : n(out.brand), structure: n(out.structure) },
    notes: productOk === false && productIssue ? `Wrong product: ${productIssue}` : personOk === false ? `Wrong person: ${personIssue || "not our model"}` : notes,
    productOk,
    productIssue,
    personOk,
  };
}

/** The generation prompt for one result, written from the plan. */
export function adaptPrompt(plan: AdaptPlan, attachments: Attachment[], rules: string, fix?: string): string {
  const roles = attachments.map((a, n) => {
    const k = n + 1;
    if (a.role === "reference") return `Image ${k} is the competitor's ad: copy its layout, composition, hierarchy and mood exactly; do not copy its product, people, brand name, logo or words, and do not take its product's colours.`;
    if (a.role === "product" && isContents(a.kind)) return `Image ${k} shows what is inside our pack (the ${a.kind}): wherever ${a.kind} appear outside the pack (loose, in a hand, a patch on the skin) they look exactly like this; it is not the packaging.`;
    if (a.role === "product") return `Image ${k} is the front of our product pack: reproduce it exactly, same container, same body, cap and label colours, every word of the label copied letter for letter and legible, at true size (it fits in a hand). Show this front facing the camera, large and clear enough to recognise at a glance; never its back or side instead. Do not recolour it to match the ad.`;
    if (a.role === "model") return `Image ${k} is our model: whenever a person appears, it is this exact individual (same face, hair, skin), never anyone from the reference.`;
    return `Image ${k} is a look reference: style only.`;
  });
  const text = plan.plan.final_text.trim()
    ? `Text on the image, rendered exactly, letter for letter, nothing added or removed: ${plan.plan.final_text.split("\n").map((l) => `"${l.trim().replace(/"/g, "'")}"`).join(" / ")}. Typography as described in the design, crisp and fully legible.`
    : "No text on the image.";
  return [
    plan.plan.design_spec.trim(),
    roles.join(" "),
    plan.product_lock && attachments.some((a) => a.role === "product" && !isContents(a.kind)) ? lockLine(plan.product_lock) : "",
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

type ModelPic = { bucket: string; path: string; label: string };

/** How many of the brand's models (newest first) the planner chooses from. */
const PLANNER_MODELS = 8;

const signOne = async (db: SupabaseClient, pic: { bucket: string; path: string }) =>
  (pic.bucket === HOOK_BUCKET ? await signHookPaths(db, [pic.path]) : await signBoardPaths(db, [pic.path])).get(pic.path) ?? null;

/** Steps 1–3: plan (or reuse a plan on a change), attach, write the prompt, queue the renders. */
export async function createAdaptRun(db: SupabaseClient, input: AdaptInput, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  if (!input.store.trim()) return { error: "Pick a brand" };
  if (!input.reference.path || !/^[\w./-]{3,300}$/.test(input.reference.path) || input.reference.path.includes("..")) return { error: "Pick a reference" };
  if (input.item_id && !UUID.test(input.item_id)) return { error: "Bad board card" };
  const [{ data: kit }, { data: productRows }] = await Promise.all([
    db.from("remake_brand_kits").select("rules, profile").eq("store", input.store).maybeSingle(),
    db.from("remake_brand_images").select("id, path, kind, description, pack_spec, ad_use").eq("store", input.store).order("created_at"),
  ]);
  const rules = (kit?.rules as string | undefined) ?? "";
  const profile = (kit?.profile as string | undefined) ?? "";
  const brandImages = (productRows ?? []) as BrandImageRow[];
  // The pack is what gets reproduced; a close-up of the capsules is only for scenes that show them loose.
  const { packs: packRows, contents: contentRows } = pickStaticAdPhotos(brandImages);
  const packSigned = await signBoardPaths(db, [...packRows, ...contentRows].map((p) => p.path));
  const contentUrl = contentRows[0] ? packSigned.get(contentRows[0].path) ?? null : null;
  const packs = await Promise.all(
    packRows.map(async (p) => {
      const url = packSigned.get(p.path) ?? null;
      return { row: p, url, spec: url ? await packSpecFor(db, p, url) : p.pack_spec };
    })
  );
  const productLock = packs.map((p) => p.spec).filter((x): x is string => !!x).join(" Also: ") || null;

  let plan: AdaptPlan | null = null;
  let modelPic: ModelPic | null = null;
  // The brand's own models only (its person-library folder): a brand without one gets a person cast from the reference and its profile, never another brand's model.
  const models = (await loadBrandModels(db, input.store)).filter((m) => m.url);
  if (input.change) {
    const { data: prev } = await db.from("image_studio_runs").select("plan, attachments").eq("id", input.change.run_id).maybeSingle();
    plan = (prev?.plan as AdaptPlan | null) ?? null;
    if (!plan) return { error: "That run has no plan to reuse" };
    // Keep the earlier run's model only if it is one of this brand's own (older runs could borrow another brand's).
    const prevModel = ((prev?.attachments as Attachment[]) ?? []).find((a) => a.role === "model");
    modelPic = input.model ?? (prevModel && models.some((m) => m.path === prevModel.path) ? { bucket: prevModel.bucket, path: prevModel.path, label: prevModel.label } : null);
    plan = { ...plan, plan: { ...plan.plan, design_spec: `${plan.plan.design_spec} Change requested by the marketer, apply it: ${input.change.note.trim()}` } };
  } else {
    const referenceUrl = await signOne(db, input.reference);
    if (!referenceUrl) return { error: "Reference image not found" };
    const asked = input.model ? await signOne(db, input.model) : null;
    const candidates: Array<ModelPic & { url: string }> =
      input.model && asked
        ? [{ ...input.model, url: asked }]
        : models.slice(0, PLANNER_MODELS).map((m) => ({ bucket: m.bucket, path: m.path, label: m.name || `${input.store} model`, url: m.url! }));
    plan = await planAdaptation(db, {
      referenceUrl,
      store: input.store,
      profile,
      rules,
      packs: packs.filter((p) => p.url).map((p) => ({ url: p.url!, spec: p.spec, kind: p.row.kind, description: p.row.description })),
      contents: contentRows[0] && contentUrl ? { url: contentUrl, kind: contentRows[0].kind, description: contentRows[0].description } : null,
      notes: input.notes,
      models: candidates.map((c) => ({ url: c.url, label: c.label })),
      modelForced: !!asked,
    });
    if (!plan) return { error: "Claude could not study the reference (is the Anthropic key set?)" };
    const pick = asked ? 1 : plan.plan.model_pick ?? 0;
    const chosen = plan.plan.needs_person ? candidates[pick - 1] : undefined;
    if (chosen) modelPic = { bucket: chosen.bucket, path: chosen.path, label: chosen.label };
  }
  plan.model_label = modelPic?.label ?? null;
  plan.product_lock = productLock;
  const showsContents = plan.plan.shows_contents === true;
  const productAttachments: Attachment[] = plan.plan.needs_product
    ? [...packRows, ...(showsContents ? contentRows : [])].map((p) => ({ bucket: BOARD_BUCKET, path: p.path, role: "product" as const, label: `${input.store} · ${p.kind ?? "product"}`, kind: p.kind }))
    : [];

  const attachments: Attachment[] = [
    { bucket: input.reference.bucket, path: input.reference.path, role: "reference", label: input.reference.label.slice(0, 80) },
    ...productAttachments,
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
