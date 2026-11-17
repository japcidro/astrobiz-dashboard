import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { askText, askVision, lastClaudeError } from "@/lib/remake/vision";
import { loadBrandModels } from "@/lib/remake/views";
import { evidenceFacts, loadPageEvidence } from "./evidence";
import { PLANNER_MODELS, isBag, isContents, lockLine, packSpecFor, pesoLikeCopy, recentHeadlines } from "./adapt";
import { FORMAT_FINISH, OWN_PLAYBOOK } from "./playbook";
import { OWN_APPROACHES, OWN_FORMATS, ownFinalText, photosForProduct, pickStaticAdPhotos, productsOf, type AdaptPlan, type Attachment, type OwnApproach, type OwnConcept, type OwnFormat, type OwnPlanRow, type PageEvidence } from "./types";

/**
 * "Create your own": original static ads for one page, with no reference ad.
 * The planner writes a creative plan (a handful of concepts, each with its
 * reasoning, its words and its picture); nothing is generated until concepts
 * are approved, and each approved concept becomes a run the usual reviewer
 * checks. The thinking is in ./playbook.
 */

const UUID = /^[0-9a-f-]{36}$/;
/** Feed placement: every original is a 4:5 portrait. */
const OWN_FORMAT = "4:5" as const;

type BrandImageRow = { id: string; path: string; kind: string | null; description: string | null; pack_spec: string | null; ad_use: string | null; product: string | null };
type ModelPic = { bucket: string; path: string; label: string; url: string };

export interface BrandContext {
  rules: string;
  profile: string;
  product: string | null;
  otherProducts: string[];
  packRows: BrandImageRow[];
  contentRows: BrandImageRow[];
  packs: Array<{ row: BrandImageRow; url: string | null; spec: string | null }>;
  contentUrl: string | null;
  productLock: string | null;
  models: ModelPic[];
}

/** What the planner and the renders need to know about a page: its profile, rules, pack photos (with their exact description) and models. */
async function brandContext(db: SupabaseClient, store: string, wantedProduct: string | null, notes: string): Promise<BrandContext> {
  const [{ data: kit }, { data: productRows }] = await Promise.all([
    db.from("remake_brand_kits").select("rules, profile").eq("store", store).maybeSingle(),
    db.from("remake_brand_images").select("id, path, kind, description, pack_spec, ad_use, product").eq("store", store).order("created_at"),
  ]);
  const all = (productRows ?? []) as BrandImageRow[];
  const names = productsOf(all);
  let product: string | null = null;
  if (names.length > 1) {
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    product = names.find((n) => wantedProduct && same(n, wantedProduct)) ?? names.find((n) => notes.toLowerCase().includes(n.toLowerCase())) ?? names[0];
  }
  const { packs: packRows, contents: contentRows } = pickStaticAdPhotos(photosForProduct(all, product));
  const signed = await signBoardPaths(db, [...packRows, ...contentRows].map((p) => p.path));
  const packs = await Promise.all(
    packRows.map(async (row) => {
      const url = signed.get(row.path) ?? null;
      return { row, url, spec: url ? await packSpecFor(db, row, url) : row.pack_spec };
    })
  );
  const models = (await loadBrandModels(db, store)).filter((m) => m.url).slice(0, PLANNER_MODELS).map((m) => ({ bucket: m.bucket, path: m.path, label: m.name || `${store} model`, url: m.url! }));
  return {
    rules: (kit?.rules as string | undefined) ?? "",
    profile: (kit?.profile as string | undefined) ?? "",
    product,
    otherProducts: names.filter((n) => n !== product),
    packRows,
    contentRows,
    packs,
    contentUrl: contentRows[0] ? signed.get(contentRows[0].path) ?? null : null,
    productLock: packs.map((p) => p.spec).filter((x): x is string => !!x).join(" Also: ") || null,
    models,
  };
}

const CONCEPT_SHAPE = `{"title":string,"approach":"offer"|"replacement"|"trust"|"identity"|"situation","format":"sorting_line"|"authority"|"replacement"|"native_comparison"|"story_post"|"meme"|"offer","audience":string,"insight":string,"authority":string,"headline":string,"subhead":string,"callouts":[string],"cta":string,"visual":string,"polish":"native"|"designed","why":string,"borrowed":string,"evidence":string,"next_test":string,"needs_person":boolean,"model":number,"person":string,"needs_product":boolean,"shows_contents":boolean,"design_spec":string}`;

const CONCEPT_FIELDS = `Each concept:
- title: three to five words that name the idea.
- audience: the one person, in one sentence (a trait, a habit or a moment; e.g. "the dad who wears a cap to every family photo").
- insight: what this person cares about today or what stops them buying, in one sentence. This is the reason the message was chosen.
- authority: who they look up to and who appears as that figure, with the visual cues that make it readable; "" when the ad has no figure.
- headline, subhead, callouts, cta: the exact words on the image, filled as the format's text slots say; "" or [] for a slot the format leaves empty. No other words appear on the image.
- visual: the picture in two plain sentences, for a marketer to read.
- polish: "native" when it should look like a real person's post, "designed" when it is a layout.
- why: why this should work for this person, one or two sentences.
- borrowed: which idea it uses and where it comes from (e.g. "Sorting line, as in Ridge's chain ad: the headline is about the person, not the product").
- evidence: when the page's own results are given, which winner this builds on, with its numbers and what it takes from it (e.g. "Builds on DHT-0722 (127 purchases at ₱451): same cortisol angle, its 'follicles are asleep' line as the hook"), or "New angle, not tested on this page yet" and why; "" when no results are given.
- next_test: the next version to test if this one gets spend, one sentence.
- needs_person: true when a real human (face, body or hands) is in the picture. model: when a person is needed and OUR MODEL photos are attached, the number of the one who fits who the picture needs (same age group, gender and role); 0 when none fits, when none is attached, or when no person is needed. person: who appears, in a few words with gender and age, or "".
- needs_product: true when our pack is in the picture (true for every format except, sometimes, a meme). shows_contents: true only when what is inside the pack appears outside it (loose capsules or gummies, a patch on skin).
- design_spec: 130 to 220 words for an image model, a 4:5 portrait: the composition zone by zone; who is there (when model is 0: age, gender, build, look and clothing, a real Filipino who looks like the buyer; when a model is picked, only pose, expression and clothing); the place and its light; where our pack sits and how big, as a real object in the scene (resting on a surface or held in a hand at true size, lit by the scene with a soft contact shadow, its front toward the camera, sharp and readable, described exactly as in its photo with its real colours); each text block quoting its exact words with its look and position (name a typeface by its look, like "bold condensed sans-serif caps" or "uneven green marker handwriting", never by a font name); palette with hex codes from the brand for any designed type or panels. Describe, do not list rules.`;

function plannerFacts(ctx: BrandContext, store: string, brief: string, avoid: string[], evidence: PageEvidence | null): string {
  return [
    `The page: ${store}.\nBrand profile:\n${ctx.profile.trim() || "(no profile yet; use only what the product photos show, and keep claims generic)"}`,
    ctx.product ? `These ads sell ${ctx.product}, the product in the attached photo. The brand also sells ${ctx.otherProducts.join(", ")}: the profile covers every product, so take the name, features, price, offer and proof points from the ${ctx.product} part only, and never show or describe another product.` : "",
    ctx.rules.trim() ? `Brand rules: ${ctx.rules.trim()}` : "",
    ctx.packs.length
      ? `Our product pack, its front (photo attached): ${ctx.packs.map((p) => p.spec ?? `${p.row.kind ?? "product"}${p.row.description ? ` (${p.row.description})` : ""}`).join(" Also: ")}${ctx.packs.some((p) => isBag(p.row.kind)) ? " It is a bag: it is carried on a shoulder, held by its straps or stands on a surface, about as wide as a torso; never held in a palm." : ""}`
      : "No product photos for this page, so no pack can be shown: set needs_product to false in every concept and let the words name the product.",
    ctx.contentRows[0] && ctx.contentUrl ? `What is inside the pack (photo attached): ${ctx.contentRows[0].kind ?? "the contents"}${ctx.contentRows[0].description ? `, ${ctx.contentRows[0].description}` : ""}.` : "",
    ctx.models.length
      ? `${ctx.models.length === 1 ? "One photo" : `${ctx.models.length} photos`} of the page's own models ${ctx.models.length === 1 ? "is" : "are"} attached (OUR MODEL 1${ctx.models.length > 1 ? `–${ctx.models.length}` : ""}). They look like the customer. Pick one only when the picture needs someone like them; an authority figure of another age or role is cast from your description (model 0).`
      : "No model photos for this page: set model to 0 and describe the person yourself.",
    evidence ? evidenceFacts(evidence) : "No ad results are available for this page, so the plan stands on the brand profile alone; leave each concept's evidence empty.",
    avoid.length ? `Headlines this page already ran or was already offered: ${avoid.map((h) => `"${h}"`).join(", ")}. Every new headline is new: not one of these and not their key phrase reworded.` : "",
    brief.trim() ? `What the marketer asked for, which wins over your own preferences (but never over the brand's facts and compliance): ${brief.trim()}` : "The marketer gave no brief: choose the strongest angles for this page yourself.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function plannerImages(ctx: BrandContext, evidence: PageEvidence | null): Array<{ url: string; label: string; maxSide?: number }> {
  return [
    // The page's best-selling statics, to see what a winning image looks like here; learned from, never copied.
    ...(evidence?.winners ?? [])
      .filter((w) => w.kind === "image" && w.image_url)
      .slice(0, 2)
      .map((w) => ({ url: w.image_url!, label: `A WINNING STATIC AD of this page, "${w.ad}" (${w.purchases} purchases${w.cpp ? ` at ₱${w.cpp}` : ""}). Study what it shows and says; do not copy its layout:`, maxSide: 1000 })),
    ...ctx.packs.filter((p) => p.url).slice(0, 1).map((p) => ({ url: p.url!, label: "OUR product pack, its front, as it really looks:" })),
    ...(ctx.contentUrl ? [{ url: ctx.contentUrl, label: "What is inside OUR pack, as it really looks:", maxSide: 800 }] : []),
    ...ctx.models.map((m, i) => ({ url: m.url, label: `OUR MODEL ${i + 1}${m.label ? ` (${m.label})` : ""}:`, maxSide: 640 })),
  ];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** One concept as Claude wrote it, made safe to store and to render from. */
export function cleanConcept(raw: unknown, id: string, canShowProduct: boolean, modelCount: number): OwnConcept | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const format = OWN_FORMATS.includes(r.format as OwnFormat) ? (r.format as OwnFormat) : null;
  const design = str(r.design_spec, 2500);
  if (!format || !design) return null;
  const callouts = (Array.isArray(r.callouts) ? r.callouts : []).map((c) => str(c, 140).replace(/\s*\n+\s*/g, " ")).filter(Boolean).slice(0, 4);
  // A slot is one line: a headline that came back as two becomes headline + subhead when the subhead is free.
  const headLines = str(r.headline, 300).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const oneLine = (v: string) => v.replace(/\s*\n+\s*/g, " ");
  const headline = (headLines[0] ?? "").slice(0, 160);
  const subhead = oneLine(str(r.subhead, 200)) || headLines.slice(1).join(" ").slice(0, 200);
  const cta = oneLine(str(r.cta, 120));
  if (!headline && !subhead && callouts.length === 0) return null;
  const needsPerson = r.needs_person === true;
  const pick = Math.max(0, Math.round(Number(r.model) || 0));
  const concept: OwnConcept = {
    id,
    title: str(r.title, 80) || "Concept",
    approach: OWN_APPROACHES.includes(r.approach as OwnApproach) ? (r.approach as OwnApproach) : "identity",
    format,
    audience: str(r.audience, 300),
    insight: str(r.insight, 400),
    authority: str(r.authority, 300),
    headline,
    subhead,
    callouts,
    cta,
    visual: str(r.visual, 500),
    polish: r.polish === "designed" ? "designed" : "native",
    why: str(r.why, 500),
    borrowed: str(r.borrowed, 300),
    next_test: str(r.next_test, 300),
    evidence: str(r.evidence, 400),
    needs_person: needsPerson,
    person: needsPerson ? str(r.person, 80) : "",
    model_pick: needsPerson && pick <= modelCount ? pick : 0,
    needs_product: canShowProduct && r.needs_product !== false,
    shows_contents: r.shows_contents === true,
    design_spec: "",
    run_id: null,
  };
  concept.design_spec = pesoLikeCopy(design, ownFinalText(concept));
  return concept;
}

const newId = () => `c${Math.random().toString(36).slice(2, 9)}`;

/** Ask with the pack and model photos when there are any, in words alone otherwise. */
async function askPlanner<T>(db: SupabaseClient, system: string, ctx: BrandContext, question: string, maxTokens: number, evidence: PageEvidence | null): Promise<T | null> {
  const images = plannerImages(ctx, evidence);
  // A long JSON answer occasionally comes back malformed; one more try is cheap.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = images.length ? await askVision<T>(db, system, images, question, maxTokens, "medium") : await askText<T>(db, system, question, maxTokens, "medium");
    if (out) return out;
  }
  return null;
}

const SYSTEM = `You are a senior creative strategist for direct-response static ads in the Philippines, planning ORIGINAL ads for one brand page. There is no reference ad to copy. You plan; nothing is generated until the marketer approves your plan, so each concept must be clear enough to judge from its words and a sketch.\n\n${OWN_PLAYBOOK}`;

/** The creative plan for a page: the buyer's main hesitation and a set of concepts built on it. */
export async function planOwnAds(db: SupabaseClient, ctx: BrandContext, input: { store: string; brief: string; count: number; avoid: string[]; evidence?: PageEvidence | null }): Promise<{ diagnosis: string; concepts: OwnConcept[] } | null> {
  const evidence = input.evidence ?? null;
  const question = `${plannerFacts(ctx, input.store, input.brief, input.avoid, evidence)}

Write the creative plan: exactly ${input.count} concepts for this page. Between them they use at least ${Math.min(3, input.count)} different approaches and at least ${Math.min(3, input.count)} different formats, and no two are written for the same person. Most are native. Leave out a format that does not suit this product rather than force it.

Answer with JSON only, exactly this shape:
{"diagnosis":string,"concepts":[${CONCEPT_SHAPE}]}
- diagnosis: two or three sentences, under 110 words in all: what the page's own winners prove about its buyer (name them with their numbers, when results are given), why this buyer still hesitates, and which approaches answer that. It is what the whole plan stands on.
${CONCEPT_FIELDS}

JSON only, no markdown fences, no line breaks inside strings (use \\n).`;
  const out = await askPlanner<{ diagnosis?: unknown; concepts?: unknown }>(db, SYSTEM, ctx, question, 24000, evidence);
  if (!out || !Array.isArray(out.concepts)) return null;
  const concepts = out.concepts.map((c) => cleanConcept(c, newId(), ctx.packs.length > 0, ctx.models.length)).filter((c): c is OwnConcept => !!c).slice(0, 8);
  if (concepts.length === 0) return null;
  return { diagnosis: str(out.diagnosis, 1400), concepts: await tightenHeadlines(db, concepts) };
}

const PLAN_COLUMNS = "id, store, product, brief, diagnosis, concepts, evidence, status, created_at";

const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;
const MAX_HEADLINE_WORDS = 9;

/** The planner sometimes runs a headline long; one quick call cuts those to nine words and the new line replaces the old one in the design too. */
async function tightenHeadlines(db: SupabaseClient, concepts: OwnConcept[]): Promise<OwnConcept[]> {
  const long = concepts.filter((c) => wordsIn(c.headline) > MAX_HEADLINE_WORDS);
  if (long.length === 0) return concepts;
  const out = await askText<{ headlines?: unknown }>(
    db,
    "You are a direct-response copywriter for static ads in the Philippines. You shorten headlines. Answer with JSON only.",
    `Each headline below is too long to read in one second. Rewrite each in ${MAX_HEADLINE_WORDS} words or fewer (count them), keeping its meaning, its language (English or Taglish), its tone and its capitalisation style. Cut, do not squeeze; no em dashes.\n${long.map((c, i) => `${i + 1}. "${c.headline}"${c.subhead ? ` (the line under it stays: "${c.subhead}")` : ""}`).join("\n")}\n\nAnswer with JSON only: {"headlines":[string]}, in the same order.`,
    3000,
    "low"
  );
  const fresh = Array.isArray(out?.headlines) ? out.headlines : [];
  const byId = new Map<string, string>();
  long.forEach((c, i) => {
    const f = typeof fresh[i] === "string" ? fresh[i].trim().replace(/\s*\n+\s*/g, " ").slice(0, 160) : "";
    if (f && wordsIn(f) <= MAX_HEADLINE_WORDS) byId.set(c.id, f);
  });
  return concepts.map((c) => (byId.has(c.id) ? { ...c, headline: byId.get(c.id)!, design_spec: c.design_spec.split(c.headline).join(byId.get(c.id)!) } : c));
}

const toPlanRow = (r: Record<string, unknown>): OwnPlanRow => ({
  id: r.id as string,
  store: r.store as string,
  product: (r.product as string | null) ?? null,
  brief: (r.brief as string | null) ?? "",
  diagnosis: (r.diagnosis as string | null) ?? "",
  concepts: Array.isArray(r.concepts) ? (r.concepts as OwnConcept[]) : [],
  evidence: (r.evidence as PageEvidence | null) ?? null,
  status: r.status === "approved" ? "approved" : "draft",
  created_at: r.created_at as string,
});

/** The latest plans, newest first; empty when the table is not there yet. */
export async function loadOwnPlans(db: SupabaseClient): Promise<OwnPlanRow[]> {
  const { data } = await db.from("image_studio_plans").select(PLAN_COLUMNS).order("created_at", { ascending: false }).limit(12);
  return ((data ?? []) as Array<Record<string, unknown>>).map(toPlanRow);
}

/** Headlines to stay away from: the page's recent ads and what its earlier plans already offered. */
async function headlinesToAvoid(db: SupabaseClient, store: string): Promise<string[]> {
  const [{ data: runs }, { data: plans }] = await Promise.all([
    db.from("image_studio_runs").select("text_on_image").eq("store", store).in("preset", ["adapt", "own"]).order("created_at", { ascending: false }).limit(30),
    db.from("image_studio_plans").select("concepts").eq("store", store).order("created_at", { ascending: false }).limit(4),
  ]);
  const planned = ((plans ?? []) as Array<{ concepts: OwnConcept[] | null }>).flatMap((p) => (p.concepts ?? []).map((c) => c.headline || c.subhead || c.callouts[0] || "")).filter(Boolean);
  return [...new Set([...recentHeadlines((runs ?? []) as Array<{ text_on_image: string | null }>, store), ...planned.map((h) => h.replace(/"/g, "'").slice(0, 120))])].slice(0, 24);
}

/** Step 1: write a plan for a page and save it as a draft. Spends no image credits. */
export async function createOwnPlan(db: SupabaseClient, input: { store: string; product: string | null; brief: string; count: number }, createdBy: string | null): Promise<{ plan: OwnPlanRow } | { error: string }> {
  const store = input.store.trim();
  if (!store) return { error: "Pick a page" };
  const brief = input.brief.trim().slice(0, 3000);
  const count = Math.min(6, Math.max(2, Math.round(input.count || 4)));
  // The page's own results first: what sold, at what cost, and what is in the winning videos.
  const [ctx, evidence, avoid] = await Promise.all([brandContext(db, store, input.product, brief), loadPageEvidence(db, store).catch(() => null), headlinesToAvoid(db, store)]);
  const planned = await planOwnAds(db, ctx, { store, brief, count, avoid, evidence });
  if (!planned) return { error: `Claude could not write the plan: ${lastClaudeError() ?? "it gave no usable plan, try again"}` };
  const { data, error } = await db
    .from("image_studio_plans")
    .insert({ store, product: ctx.product, brief, diagnosis: planned.diagnosis, concepts: planned.concepts, evidence, created_by: createdBy })
    .select(PLAN_COLUMNS)
    .single();
  if (error || !data) return { error: error?.message ?? "Could not save the plan" };
  return { plan: toPlanRow(data as Record<string, unknown>) };
}

async function loadPlan(db: SupabaseClient, id: string): Promise<OwnPlanRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db.from("image_studio_plans").select(PLAN_COLUMNS).eq("id", id).maybeSingle();
  return data ? toPlanRow(data as Record<string, unknown>) : null;
}

/** Rewrite one concept of a draft from a note ("make it Taglish", "a lola instead of a coach"); the rest of the plan stays. */
export async function reviseOwnConcept(db: SupabaseClient, input: { planId: string; conceptId: string; note: string }): Promise<{ plan: OwnPlanRow } | { error: string }> {
  const plan = await loadPlan(db, input.planId);
  const old = plan?.concepts.find((c) => c.id === input.conceptId);
  if (!plan || !old) return { error: "Concept not found" };
  if (old.run_id) return { error: "This concept was already generated; change it from its results below" };
  const note = input.note.trim().slice(0, 800);
  if (!note) return { error: "Say what should change" };
  const ctx = await brandContext(db, plan.store, plan.product, plan.brief);
  const others = plan.concepts.filter((c) => c.id !== old.id);
  const { id: _id, run_id: _run, model_pick, ...rest } = old;
  void _id;
  void _run;
  const question = `${plannerFacts(ctx, plan.store, plan.brief, others.map((c) => c.headline || c.subhead || c.callouts[0] || "").filter(Boolean), plan.evidence)}

The plan's diagnosis: ${plan.diagnosis}
The other concepts in this plan (stay different from them): ${others.map((c) => `"${c.title}" (${c.approach}, ${c.format}, for ${c.audience})`).join("; ") || "none"}

One concept of the plan, as it stands:
${JSON.stringify({ ...rest, model: model_pick })}

The marketer wants it changed: ${note}
Rewrite this one concept so the change is applied everywhere it touches (the words, the picture, the design_spec, the reasoning). Keep what the note does not touch. Words the note puts in quotes go on the image exactly as written. If the change calls for another approach or format, switch.

Answer with JSON only, exactly this shape:
${CONCEPT_SHAPE}
${CONCEPT_FIELDS}

JSON only, no markdown fences, no line breaks inside strings (use \\n).`;
  const out = await askPlanner<unknown>(db, SYSTEM, ctx, question, 8000, plan.evidence);
  const fresh = cleanConcept(out, old.id, ctx.packs.length > 0, ctx.models.length);
  if (!fresh) return { error: `Claude could not rewrite the concept: ${lastClaudeError() ?? "try again"}` };
  // Words the marketer quoted stay as written, however long.
  const [tight] = /["“]/.test(note) ? [fresh] : await tightenHeadlines(db, [fresh]);
  const concepts = plan.concepts.map((c) => (c.id === old.id ? tight : c));
  const { error } = await db.from("image_studio_plans").update({ concepts }).eq("id", plan.id);
  if (error) return { error: error.message };
  return { plan: { ...plan, concepts } };
}

/** The generation prompt for one approved concept: the design, what each attached photo is, the pack lock, the exact words. */
export function ownPrompt(concept: OwnConcept, attachments: Attachment[], rules: string, productLock: string | null, change?: string): string {
  const roles = attachments.map((a, n) => {
    const k = n + 1;
    if (a.role === "product" && isContents(a.kind)) return `Image ${k} shows what is inside our pack (the ${a.kind}): wherever ${a.kind} appear outside the pack (loose, in a hand, a patch on the skin) they look exactly like this; it is not the packaging.`;
    if (a.role === "product" && isBag(a.kind)) return `Image ${k} is our bag: reproduce it exactly, the same shape, canvas, colour, straps, zip and print, with the lettering on the body and along the straps copied letter for letter and legible, at its true size: a tote about as wide as a woman's torso, carried on a shoulder, held by its straps or standing on a surface, never shrunk to fit a palm. Photograph it inside the scene, not as a cutout: lit by the scene's own light with a soft contact shadow where it rests, matching the camera's perspective, focus and grain. Its printed front faces the camera (a slight angle is natural), sharp and readable. When the photo shows two colours of the bag, they are the only colours it comes in; never invent another colour.`;
    if (a.role === "product") return `Image ${k} is the front of our product pack: reproduce it exactly, same container, same body, cap and label colours, every word of the label copied letter for letter and legible, at true size (it fits in a hand). Photograph it inside the scene, not as a cutout: it rests on a surface or sits in a hand at its true size, lit by the scene's own light with a soft contact shadow, matching the camera's perspective, focus and grain. Its front faces the camera (a slight angle is natural), sharp and readable; never its back or side. Do not recolour it to match the ad.`;
    if (a.role === "model") return `Image ${k} is our model: the only person in the image is this exact individual (same face, hair, skin tone and age), in the pose, expression and clothing the design describes.`;
    return `Image ${k} is a look reference: style only.`;
  });
  const finalText = ownFinalText(concept);
  const text = finalText
    ? `Text on the image, rendered exactly, letter for letter, nothing added or removed: ${finalText.split("\n").map((l) => `"${l.replace(/"/g, "'")}"`).join(" / ")}. Lettering as described in the design, fully legible.`
    : "No text on the image.";
  const native = concept.polish === "native";
  return [
    concept.design_spec.trim(),
    FORMAT_FINISH[concept.format] ?? "",
    roles.join(" "),
    productLock && attachments.some((a) => a.role === "product" && !isContents(a.kind)) ? lockLine(productLock) : "",
    text,
    concept.needs_person || concept.format === "meme" ? "" : "No person in the image unless the design above asks for hands.",
    concept.needs_person && !attachments.some((a) => a.role === "model") ? "The person is an ordinary Filipino who looks like a real customer, not a model: natural skin, everyday clothes, nobody famous and no lookalike of a real person." : "",
    native
      ? "Portrait 4:5. It must pass for a real person's own post, not an advertisement: where there is a photo it is one real phone photograph in which the product, the people and the place share the same light, shadows, perspective, focus and grain, and nothing looks pasted on or floats. No watermark, no competitor branding, no logo or button that the design does not ask for."
      : "Portrait 4:5. A finished, designed advertisement: the photo is one real photograph, where the product, the people and the place share the same light, shadows, perspective, focus and grain, and nothing looks pasted on or floats; clean vector-sharp typography sits on top; no watermark, no competitor branding.",
    rules.trim() ? `Brand rules: ${rules.trim()}.` : "",
    change ? `Change requested by the marketer, apply it: ${change}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A concept in the shape the runs list and the reviewer already read. */
const toAdaptPlan = (concept: OwnConcept, extra: { productLock: string | null; product: string | null; modelLabel: string | null }): AdaptPlan => ({
  study: { angle: `${concept.title}: ${concept.headline || concept.subhead || concept.callouts[0] || ""}`.slice(0, 300), structure: concept.visual.slice(0, 400), style: concept.polish === "native" ? "Native: looks like a real person's post" : "Designed layout", why_it_works: concept.why.slice(0, 400) },
  plan: { text: [], final_text: ownFinalText(concept).slice(0, 800), needs_person: concept.needs_person, person: concept.person, model_pick: concept.model_pick, needs_product: concept.needs_product, shows_contents: concept.shows_contents, design_spec: concept.design_spec },
  model_label: extra.modelLabel,
  product: extra.product,
  product_lock: extra.productLock,
  own: concept,
});

/** Save a run for one concept and queue its renders. */
async function queueOwnRun(
  db: SupabaseClient,
  input: { store: string; concept: OwnConcept; attachments: Attachment[]; rules: string; productLock: string | null; product: string | null; modelLabel: string | null; versions: number; instruction: string; itemId: string | null; change?: string },
  createdBy: string | null
): Promise<{ id: string } | { error: string }> {
  const { concept, attachments } = input;
  const prompt = ownPrompt(concept, attachments, input.rules, input.productLock, input.change);
  const versions = Math.min(4, Math.max(1, Math.round(input.versions || 1)));
  const hasModel = attachments.some((a) => a.role === "model");
  const { data: run, error } = await db
    .from("image_studio_runs")
    .insert({
      item_id: input.itemId,
      store: input.store,
      preset: "own",
      instruction: input.instruction.slice(0, 3000),
      product_mode: attachments.some((a) => a.role === "product") ? "in" : "none",
      person_mode: concept.needs_person ? (hasModel ? "model" : "new") : "none",
      output: "single",
      format: OWN_FORMAT,
      versions,
      text_on_image: ownFinalText(concept).slice(0, 200),
      text_style: "clean",
      attachments,
      prompt,
      plan: toAdaptPlan(concept, { productLock: input.productLock, product: input.product, modelLabel: input.modelLabel }),
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
    params: { run_id: runId, result_id: r.id, prompt, images: attachments.map((a) => ({ bucket: a.bucket, path: a.path })), aspect_ratio: OWN_FORMAT, split: false },
  }));
  const { data: jobRows, error: jErr } = await db.from("hook_studio_jobs").insert(jobs).select("id, params");
  if (jErr || !jobRows) return { error: jErr?.message ?? "Could not queue the renders" };
  await Promise.all((jobRows as Array<{ id: string; params: { result_id: string } }>).map((j) => db.from("image_studio_results").update({ job_id: j.id }).eq("id", j.params.result_id)));
  return { id: runId };
}

/** Step 2: the owner approved these concepts. Each one becomes a run; this is where image credits are first spent. */
export async function approveOwnPlan(db: SupabaseClient, input: { planId: string; conceptIds: string[]; versions: number; itemId: string | null }, createdBy: string | null): Promise<{ started: number } | { error: string }> {
  const plan = await loadPlan(db, input.planId);
  if (!plan) return { error: "Plan not found" };
  if (input.itemId && !UUID.test(input.itemId)) return { error: "Bad board card" };
  const picked = plan.concepts.filter((c) => input.conceptIds.includes(c.id) && !c.run_id);
  if (picked.length === 0) return { error: "Tick at least one concept to approve" };
  const ctx = await brandContext(db, plan.store, plan.product, plan.brief);
  const failures: string[] = [];
  const runIds = new Map<string, string>();
  for (const concept of picked) {
    const model = concept.needs_person ? ctx.models[concept.model_pick - 1] : undefined;
    const attachments: Attachment[] = [
      ...(concept.needs_product ? [...ctx.packRows, ...(concept.shows_contents ? ctx.contentRows : [])].map((p) => ({ bucket: BOARD_BUCKET, path: p.path, role: "product" as const, label: `${plan.store} · ${p.kind ?? "product"}`, kind: p.kind })) : []),
      ...(model ? [{ bucket: model.bucket, path: model.path, role: "model" as const, label: model.label.slice(0, 80) }] : []),
    ];
    const result = await queueOwnRun(
      db,
      { store: plan.store, concept, attachments, rules: ctx.rules, productLock: ctx.productLock, product: ctx.product, modelLabel: model?.label ?? null, versions: input.versions, instruction: plan.brief, itemId: input.itemId },
      createdBy
    );
    if ("error" in result) failures.push(`${concept.title}: ${result.error}`);
    else runIds.set(concept.id, result.id);
  }
  if (runIds.size) {
    // Read again before writing: another concept may have been revised while these queued.
    const latest = (await loadPlan(db, plan.id)) ?? plan;
    await db.from("image_studio_plans").update({ status: "approved", concepts: latest.concepts.map((c) => (runIds.has(c.id) ? { ...c, run_id: runIds.get(c.id) } : c)) }).eq("id", plan.id);
  }
  if (runIds.size === 0) return { error: failures.join(" · ") || "Nothing could be queued" };
  return { started: runIds.size };
}

/** Run an original again with a note, keeping its concept, its photos and its pack lock. */
export async function rerunOwn(db: SupabaseClient, input: { runId: string; note: string; versions: number }, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  if (!UUID.test(input.runId)) return { error: "Run not found" };
  const note = input.note.trim().slice(0, 500);
  if (!note) return { error: "Say what should change" };
  const { data: prev } = await db.from("image_studio_runs").select("item_id, store, plan, attachments").eq("id", input.runId).maybeSingle();
  const plan = (prev?.plan as AdaptPlan | null) ?? null;
  if (!prev || !plan?.own) return { error: "That run has no concept to reuse" };
  const store = (prev.store as string | null) ?? "";
  const { data: kit } = await db.from("remake_brand_kits").select("rules").eq("store", store).maybeSingle();
  return queueOwnRun(
    db,
    {
      store,
      concept: plan.own,
      attachments: ((prev.attachments as Attachment[]) ?? []).filter((a) => a.role !== "reference"),
      rules: (kit?.rules as string | undefined) ?? "",
      productLock: plan.product_lock ?? null,
      product: plan.product ?? null,
      modelLabel: plan.model_label ?? null,
      versions: input.versions,
      instruction: `Change: ${note}`,
      itemId: (prev.item_id as string | null) ?? null,
      change: note,
    },
    createdBy
  );
}

/** Drop a plan. Runs already generated from it stay in the list below. */
export async function deleteOwnPlan(db: SupabaseClient, id: string): Promise<string | null> {
  if (!UUID.test(id)) return "Plan not found";
  const { error } = await db.from("image_studio_plans").delete().eq("id", id);
  return error ? error.message : null;
}
