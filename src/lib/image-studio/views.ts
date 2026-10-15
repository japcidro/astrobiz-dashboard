import type { SupabaseClient } from "@supabase/supabase-js";
import { HOOK_BUCKET, signPaths as signHookPaths } from "@/lib/hook-studio/storage";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { brandCheck } from "@/lib/remake/vision";
import { aspectFor, studioPrompt } from "./prompt";
import type { Attachment, AttachmentView, ResultRow, ResultView, RunInput, RunRow, RunView, StudioPage, StudioSources } from "./types";

const UUID = /^[0-9a-f-]{36}$/;
const key = (bucket: string, path: string) => `${bucket}:${path}`;

/** Sign paths from both buckets in one go; keys are "bucket:path". */
async function signAll(db: SupabaseClient, refs: Array<{ bucket: string; path: string | null | undefined }>): Promise<Map<string, string>> {
  const board = refs.filter((r) => r.bucket === BOARD_BUCKET && r.path).map((r) => r.path!);
  const hook = refs.filter((r) => r.bucket === HOOK_BUCKET && r.path).map((r) => r.path!);
  const [b, h] = await Promise.all([signBoardPaths(db, board), signHookPaths(db, hook)]);
  const out = new Map<string, string>();
  for (const [p, u] of b) out.set(key(BOARD_BUCKET, p), u);
  for (const [p, u] of h) out.set(key(HOOK_BUCKET, p), u);
  return out;
}

async function loadSources(db: SupabaseClient): Promise<StudioSources> {
  const [{ data: people }, { data: folders }, { data: stills }, { data: brand }, { data: board }] = await Promise.all([
    db.from("remake_people").select("id, folder_id, name, bucket, path").order("created_at", { ascending: false }).limit(300),
    db.from("remake_people_folders").select("id, name"),
    db.from("talking_head_stills").select("id, title, clip_idx, path, preview_path").is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    db.from("remake_brand_images").select("store, kind, path").order("store"),
    db.from("marketing_board_items").select("id, title, image_path").eq("kind", "image").not("image_path", "is", null).order("created_at", { ascending: false }).limit(200),
  ]);
  type P = { id: string; folder_id: string | null; name: string; bucket: string; path: string };
  type S = { id: string; title: string; clip_idx: number | null; path: string; preview_path: string | null };
  type B = { store: string; kind: string | null; path: string };
  type I = { id: string; title: string | null; image_path: string };
  const folderName = new Map(((folders ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]));
  const ps = (people ?? []) as P[];
  const ss = (stills ?? []) as S[];
  const bs = (brand ?? []) as B[];
  const is = (board ?? []) as I[];
  const signed = await signAll(db, [
    ...ps.map((p) => ({ bucket: p.bucket, path: p.path })),
    ...ss.map((s) => ({ bucket: BOARD_BUCKET, path: s.preview_path ?? s.path })),
    ...bs.map((b) => ({ bucket: BOARD_BUCKET, path: b.path })),
    ...is.map((i) => ({ bucket: BOARD_BUCKET, path: i.image_path })),
  ]);
  return {
    people: ps.map((p) => ({ id: p.id, folder: p.folder_id ? folderName.get(p.folder_id) ?? null : null, name: p.name, bucket: p.bucket, path: p.path, url: signed.get(key(p.bucket, p.path)) ?? "" })).filter((p) => p.url),
    stills: ss.map((s) => ({ id: s.id, title: s.clip_idx !== null ? `${s.title} · clip ${s.clip_idx + 1}` : s.title, bucket: BOARD_BUCKET, path: s.path, url: signed.get(key(BOARD_BUCKET, s.preview_path ?? s.path)) ?? "" })).filter((s) => s.url),
    brand: bs.map((b) => ({ store: b.store, kind: b.kind, bucket: BOARD_BUCKET, path: b.path, url: signed.get(key(BOARD_BUCKET, b.path)) ?? "" })).filter((b) => b.url),
    board: is.map((i) => ({ id: i.id, title: i.title ?? "Image", bucket: BOARD_BUCKET, path: i.image_path, url: signed.get(key(BOARD_BUCKET, i.image_path)) ?? "" })).filter((i) => i.url),
  };
}

function toResultView(r: ResultRow, signed: Map<string, string>): ResultView {
  const u = (p: string | null | undefined) => (p ? signed.get(key(BOARD_BUCKET, p)) ?? null : null);
  return { ...r, url: u(r.path), preview_url: u(r.preview_path) ?? u(r.path), pair_urls: r.pair_paths ? r.pair_paths.map((p) => u(p) ?? "") : null };
}

async function loadRuns(db: SupabaseClient, itemId: string | null): Promise<RunView[]> {
  let q = db.from("image_studio_runs").select("*").order("created_at", { ascending: false }).limit(40);
  if (itemId) q = q.eq("item_id", itemId);
  const { data: runRows } = await q;
  const runs = (runRows ?? []) as RunRow[];
  if (runs.length === 0) return [];
  const { data: resultRows } = await db.from("image_studio_results").select("*").in("run_id", runs.map((r) => r.id)).order("idx");
  const results = (resultRows ?? []) as ResultRow[];
  const signed = await signAll(db, [
    ...runs.flatMap((r) => r.attachments.map((a) => ({ bucket: a.bucket, path: a.path }))),
    ...results.flatMap((r) => [r.path, r.preview_path, ...(r.pair_paths ?? [])].map((p) => ({ bucket: BOARD_BUCKET, path: p }))),
  ]);
  return runs.map((run) => ({
    ...run,
    attachments: run.attachments.map((a): AttachmentView => ({ ...a, url: signed.get(key(a.bucket, a.path)) ?? null })),
    results: results.filter((r) => r.run_id === run.id).map((r) => toResultView(r, signed)),
  }));
}

export async function loadStudioPage(db: SupabaseClient, itemId: string | null): Promise<StudioPage> {
  const [itemRow, { data: storeRows }, { data: kits }, sources, runs] = await Promise.all([
    itemId ? db.from("marketing_board_items").select("id, title, store, image_path").eq("id", itemId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    db.from("shopify_stores").select("name").eq("is_active", true).order("name"),
    db.from("remake_brand_kits").select("store, rules"),
    loadSources(db),
    loadRuns(db, itemId),
  ]);
  let item: StudioPage["item"] = null;
  if (itemRow) {
    const path = (itemRow.image_path as string | null) ?? null;
    const signed = path ? await signBoardPaths(db, [path]) : new Map<string, string>();
    item = { id: itemRow.id as string, title: (itemRow.title as string | null) ?? null, store: (itemRow.store as string | null) ?? null, bucket: BOARD_BUCKET, path, url: path ? signed.get(path) ?? null : null };
  }
  return {
    item,
    stores: ((storeRows ?? []) as Array<{ name: string }>).map((s) => s.name),
    brand_rules: Object.fromEntries(((kits ?? []) as Array<{ store: string; rules: string }>).map((k) => [k.store, k.rules])),
    sources,
    runs,
  };
}

const okAttachment = (a: unknown): a is Attachment => {
  const x = a as Attachment;
  return !!x && (x.bucket === BOARD_BUCKET || x.bucket === HOOK_BUCKET) && typeof x.path === "string" && /^[\w./-]{3,300}$/.test(x.path) && !x.path.includes("..") && ["reference", "model", "product", "look"].includes(x.role);
};

/** Save the run, make one result row per image, and queue a Nano Banana job for each. */
export async function createRun(db: SupabaseClient, input: RunInput, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  const attachments = (input.attachments ?? []).filter(okAttachment).slice(0, 12).map((a) => ({ bucket: a.bucket, path: a.path, role: a.role, label: String(a.label ?? "").slice(0, 80) }));
  if (!input.instruction.trim() && attachments.length === 0) return { error: "Write what should come out, or attach an image" };
  if (input.item_id && !UUID.test(input.item_id)) return { error: "Bad board card" };
  const { data: kit } = input.store ? await db.from("remake_brand_kits").select("rules").eq("store", input.store).maybeSingle() : { data: null };
  const prompt = studioPrompt({
    instruction: input.instruction,
    attachments,
    product_mode: input.product_mode,
    person_mode: input.person_mode,
    output: input.output,
    format: input.format,
    text_on_image: input.text_on_image,
    text_style: input.text_style,
    brandRules: (kit?.rules as string | undefined) ?? "",
    store: input.store,
  });
  const versions = Math.min(4, Math.max(1, Math.round(input.versions || 1)));
  const count = input.output === "set3" ? 3 : versions;
  const { data: run, error } = await db
    .from("image_studio_runs")
    .insert({
      item_id: input.item_id,
      store: input.store,
      preset: input.preset,
      instruction: input.instruction.trim().slice(0, 3000),
      product_mode: input.product_mode,
      person_mode: input.person_mode,
      output: input.output,
      format: input.format,
      versions: count,
      text_on_image: input.text_on_image.trim().slice(0, 200),
      text_style: input.text_style,
      attachments,
      prompt,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !run) return { error: error?.message ?? "Could not save the run" };
  const runId = run.id as string;
  const { data: results, error: rErr } = await db
    .from("image_studio_results")
    .insert(Array.from({ length: count }, (_, idx) => ({ run_id: runId, idx, credits: STILL_CREDITS })))
    .select("id, idx");
  if (rErr || !results) return { error: rErr?.message ?? "Could not create the results" };
  const aspect = aspectFor(input.format, input.output);
  const jobs = (results as Array<{ id: string; idx: number }>).map((r) => ({
    kind: "image_gen",
    engine: "nano_banana_pro",
    status: "queued",
    params: { run_id: runId, result_id: r.id, prompt: input.output === "set3" ? `${prompt} This is image ${r.idx + 1} of 3: vary the angle or moment while keeping the style.` : prompt, images: attachments.map((a) => ({ bucket: a.bucket, path: a.path })), aspect_ratio: aspect, split: input.output === "pair" },
  }));
  const { data: jobRows, error: jErr } = await db.from("hook_studio_jobs").insert(jobs).select("id, params");
  if (jErr || !jobRows) return { error: jErr?.message ?? "Could not queue the renders" };
  await Promise.all((jobRows as Array<{ id: string; params: { result_id: string } }>).map((j) => db.from("image_studio_results").update({ job_id: j.id }).eq("id", j.params.result_id)));
  return { id: runId };
}

/** Brand-check finished results once; a model attachment makes it a person check too. */
export async function runPendingChecks(db: SupabaseClient, itemId: string | null): Promise<void> {
  let q = db.from("image_studio_results").select("*, image_studio_runs!inner(id, item_id, store, product_mode, person_mode, attachments)").eq("status", "done").is("brand_check", null).limit(4);
  if (itemId) q = q.eq("image_studio_runs.item_id", itemId);
  const { data } = await q;
  type Row = ResultRow & { image_studio_runs: { id: string; item_id: string | null; store: string | null; product_mode: string; person_mode: string; attachments: Attachment[] } };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return;
  const kits = new Map<string, string>();
  for (const r of rows) {
    const store = r.image_studio_runs.store;
    if (store && !kits.has(store)) {
      const { data: kit } = await db.from("remake_brand_kits").select("rules").eq("store", store).maybeSingle();
      kits.set(store, (kit?.rules as string | undefined) ?? "");
    }
  }
  const signed = await signAll(db, rows.flatMap((r) => [{ bucket: BOARD_BUCKET, path: r.preview_path ?? r.path }, ...r.image_studio_runs.attachments.map((a) => ({ bucket: a.bucket, path: a.path }))]));
  await Promise.all(
    rows.map(async (r) => {
      const { data: locked } = await db.from("image_studio_results").update({ brand_check: { ok: true, notes: "Checking…" } }).eq("id", r.id).is("brand_check", null).select("id");
      if (!locked || locked.length === 0) return;
      const run = r.image_studio_runs;
      const url = signed.get(key(BOARD_BUCKET, (r.preview_path ?? r.path)!));
      const products = run.product_mode === "in" ? run.attachments.filter((a) => a.role === "product").map((a) => signed.get(key(a.bucket, a.path))).filter((u): u is string => !!u) : [];
      const model = run.person_mode === "model" ? run.attachments.find((a) => a.role === "model") : undefined;
      const result = url ? await brandCheck(db, url, products, kits.get(run.store ?? "") ?? "", run.product_mode === "none", model ? { castUrl: signed.get(key(model.bucket, model.path)) ?? null, frameUrl: null } : undefined) : null;
      await db
        .from("image_studio_results")
        .update({ brand_check: result ? { ok: result.ok, notes: result.notes } : { ok: true, notes: "Not checked: Claude could not read the image." } })
        .eq("id", r.id);
    })
  );
}

/** Keep a result: it becomes an output on the board card (one per image of a pair). */
export async function keepResult(db: SupabaseClient, id: string, addedBy: string | null): Promise<string | null> {
  const { data } = await db.from("image_studio_results").select("*, image_studio_runs!inner(item_id)").eq("id", id).maybeSingle();
  if (!data) return "Not found";
  const r = data as unknown as ResultRow & { image_studio_runs: { item_id: string | null } };
  if (r.status !== "done" || !r.path) return "Not finished";
  const itemId = r.image_studio_runs.item_id;
  if (itemId) {
    const files = r.pair_paths?.length ? r.pair_paths : [r.path];
    await db.from("marketing_board_outputs").insert(files.map((f, i) => ({ item_id: itemId, kind: "upload", file_path: f, note: r.pair_paths ? (i === 0 ? "Image Studio · before" : "Image Studio · after") : "Image Studio", added_by: addedBy })));
  }
  const { error } = await db.from("image_studio_results").update({ kept: true }).eq("id", id);
  return error ? error.message : null;
}

export async function deleteRun(db: SupabaseClient, id: string): Promise<string | null> {
  const { data: results } = await db.from("image_studio_results").select("path, preview_path, pair_paths, job_id, status").eq("run_id", id);
  const rows = (results ?? []) as Array<Pick<ResultRow, "path" | "preview_path" | "pair_paths" | "job_id" | "status">>;
  const paths = rows.flatMap((r) => [r.path, r.preview_path, ...(r.pair_paths ?? [])]).filter((p): p is string => !!p);
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  const queued = rows.filter((r) => r.status === "queued" && r.job_id).map((r) => r.job_id!);
  if (queued.length) await db.from("hook_studio_jobs").update({ status: "canceled" }).in("id", queued).eq("status", "queued");
  const { error } = await db.from("image_studio_runs").delete().eq("id", id);
  return error ? error.message : null;
}
