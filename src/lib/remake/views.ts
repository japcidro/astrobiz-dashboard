import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { HOOK_BUCKET } from "@/lib/hook-studio/storage";
import { isLookId } from "@/lib/hook-studio/presets";
import { DEFAULT_CLIP_ENGINE, DEFAULT_CLIP_ENGINE_FOR, getClipEngine, isClipEngine, veoLengthFor, type ClipEngineId } from "./engines";
import { castRecipe, motionPrompt, stillPrompt, veoPrompt } from "./prompts";
import type { BrandImage, BrandKit, LibraryImage, ProjectRow, ProjectSummary, ProjectView, ShotRow, ShotView } from "./types";
import { brandCheck, describeProduct, detectChanges, labelShots } from "./vision";

const UUID = /^[0-9a-f-]{36}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const asClipEngine = (v: unknown): ClipEngineId | null => (isClipEngine(v) ? v : null);

/** Shortest clip the timeline allows, in seconds. */
export const MIN_CLIP_SECONDS = 1;

// ─── Brand kit ───

/** Label a brand kit photo with its form (bottle, gummies…) once it is registered. Best effort. */
export async function labelBrandImage(db: SupabaseClient, id: string, path: string): Promise<void> {
  const signed = await signBoardPaths(db, [path]);
  const url = signed.get(path);
  if (!url) return;
  const d = await describeProduct(db, url);
  if (d) await db.from("remake_brand_images").update({ kind: d.kind, description: d.description }).eq("id", id);
}

export async function loadBrandKit(db: SupabaseClient, store: string | null, signed?: Map<string, string>): Promise<BrandKit | null> {
  if (!store) return null;
  const [{ data: kit }, { data: imgs }] = await Promise.all([
    db.from("remake_brand_kits").select("*").eq("store", store).maybeSingle(),
    db.from("remake_brand_images").select("*").eq("store", store).order("created_at"),
  ]);
  const rows = (imgs ?? []) as Array<Omit<BrandImage, "url">>;
  const s = signed ?? (await signBoardPaths(db, rows.map((r) => r.path)));
  return { store, rules: (kit?.rules as string | undefined) ?? "", images: rows.map((r) => ({ ...r, url: s.get(r.path) ?? null })) };
}

// ─── Projects ───

const toShotView = (s: ShotRow, signed: Map<string, string>): ShotView => {
  const url = (p: string | null) => (p ? signed.get(p) ?? null : null);
  const mixed = s.mixed_status === "done" ? url(s.mixed_path) : null;
  const own = s.clip_status === "done" ? url(s.clip_path) : null;
  return {
    ...s,
    frame_url: url(s.frame_path),
    ref_url: url(s.ref_path),
    still_url: url(s.still_path),
    still_preview_url: url(s.still_preview_path) ?? url(s.still_path),
    audio_url: url(s.audio_path),
    clip_url: url(s.clip_path),
    mixed_url: url(s.mixed_path),
    final_url: mixed ?? (s.mode === "keep" ? url(s.ref_path) : own),
    seconds: Math.round((Number(s.end_s) - Number(s.start_s)) * 10) / 10,
  };
};

export async function loadProject(db: SupabaseClient, id: string): Promise<ProjectView | null> {
  const { data: row } = await db.from("remake_projects").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const project = row as ProjectRow;
  const [{ data: shotRows }, { data: boardItem }, { data: imgs }] = await Promise.all([
    db.from("remake_shots").select("*").eq("project_id", id).order("idx"),
    project.board_item_id ? db.from("marketing_board_items").select("title").eq("id", project.board_item_id).maybeSingle() : Promise.resolve({ data: null }),
    project.store ? db.from("remake_brand_images").select("path").eq("store", project.store) : Promise.resolve({ data: [] }),
  ]);
  const shots = (shotRows ?? []) as ShotRow[];
  const signed = await signBoardPaths(db, [
    project.source_path,
    project.strip_path,
    project.cast_path,
    ...shots.flatMap((s) => [s.frame_path, s.ref_path, s.still_path, s.still_preview_path, s.audio_path, s.clip_path, s.mixed_path]),
    ...((imgs ?? []) as Array<{ path: string }>).map((i) => i.path),
  ]);
  return {
    ...project,
    source_url: signed.get(project.source_path) ?? null,
    strip_url: project.strip_path ? signed.get(project.strip_path) ?? null : null,
    cast_url: project.cast_path ? signed.get(project.cast_path) ?? null : null,
    board_item_title: (boardItem?.title as string | undefined) ?? null,
    shots: shots.map((s) => toShotView(s, signed)),
    brand_kit: await loadBrandKit(db, project.store, signed),
  };
}

export async function loadProjects(db: SupabaseClient): Promise<ProjectSummary[]> {
  const { data: rows } = await db.from("remake_projects").select("*").order("created_at", { ascending: false }).limit(100);
  const projects = (rows ?? []) as ProjectRow[];
  if (projects.length === 0) return [];
  const { data: shotRows } = await db
    .from("remake_shots")
    .select("project_id, idx, frame_path, still_path, clip_status, mode")
    .in("project_id", projects.map((p) => p.id))
    .order("idx");
  const shots = (shotRows ?? []) as Array<Pick<ShotRow, "project_id" | "idx" | "frame_path" | "still_path" | "clip_status" | "mode">>;
  const covers = new Map<string, string>();
  for (const s of shots) {
    const p = s.still_path ?? s.frame_path;
    if (p && !covers.has(s.project_id)) covers.set(s.project_id, p);
  }
  const signed = await signBoardPaths(db, Array.from(covers.values()));
  return projects.map((p) => {
    const mine = shots.filter((s) => s.project_id === p.id);
    const cover = covers.get(p.id);
    return {
      id: p.id,
      title: p.title,
      store: p.store,
      status: p.status,
      shots: mine.length,
      clips_done: mine.filter((s) => s.clip_status === "done" || s.mode === "keep").length,
      cover_url: cover ? signed.get(cover) ?? null : null,
      created_at: p.created_at,
    };
  });
}

/** Finished UGC Generator images, newest first, for "use an existing image". */
export async function loadLibraryImages(db: SupabaseClient): Promise<LibraryImage[]> {
  const { data } = await db
    .from("hook_studio_jobs")
    .select("id, params, result_path, created_at")
    .eq("kind", "ugc_image")
    .eq("status", "done")
    .not("result_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Array<{ id: string; params: Record<string, unknown>; result_path: string; created_at: string }>;
  const { data: signed } = await db.storage.from(HOOK_BUCKET).createSignedUrls(rows.map((r) => r.result_path), 3600);
  const urls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  return rows
    .filter((r) => urls.has(r.result_path))
    .map((r) => ({ id: r.id, url: urls.get(r.result_path)!, note: (r.params.note as string | undefined) ?? "", created_at: r.created_at }));
}

// ─── Queueing ───

async function queue(db: SupabaseClient, kind: string, engine: string, params: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from("hook_studio_jobs").insert({ kind, engine, params, status: "queued" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not queue the job");
  return data.id as string;
}

export async function queueSplit(db: SupabaseClient, project: Pick<ProjectRow, "id" | "source_path">) {
  await queue(db, "remake_split", "ffmpeg", { project_id: project.id, source_path: project.source_path });
}

/** Cut the real clip and grab the frame again for shots whose bounds changed. */
export async function queueFrames(db: SupabaseClient, project: Pick<ProjectRow, "id" | "source_path">, shots: Array<Pick<ShotRow, "id" | "idx" | "start_s" | "end_s">>, relabel: boolean) {
  if (shots.length === 0) return;
  await queue(db, "remake_frames", "ffmpeg", {
    project_id: project.id,
    source_path: project.source_path,
    relabel,
    shots: shots.map((s) => ({ id: s.id, idx: s.idx, start_s: Number(s.start_s), end_s: Number(s.end_s) })),
  });
}

/** Queue the still for a shot: frame + (cast image) + product photos → Nano Banana Pro. */
export async function queueStill(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  if (!shot.frame_path) return "This clip has no frame yet";
  const kit = await loadBrandKit(db, project.store);
  // The person for the scene: a picked image, or the approved still the cast was locked to.
  let castPath: string | null = project.cast_path ?? null;
  if (!castPath && project.cast_shot_id && project.cast_shot_id !== shot.id) {
    const { data: cast } = await db.from("remake_shots").select("still_path").eq("id", project.cast_shot_id).maybeSingle();
    castPath = (cast?.still_path as string | null) ?? null;
  }
  // Products that match what is held come first; the rest fill up to four.
  const held = shot.holds && shot.holds !== "none" ? shot.holds : null;
  const images = kit?.images ?? [];
  const ranked = held ? [...images.filter((i) => i.kind === held), ...images.filter((i) => i.kind !== held)] : images;
  const chosen = (held && ranked.some((i) => i.kind === held) ? ranked.filter((i) => i.kind === held) : ranked).slice(0, 4);
  const productPaths = chosen.map((i) => i.path);
  const look = isLookId(project.cast_look) ? project.cast_look : "varied";
  const prompt = stillPrompt({
    recipe: castRecipe(look),
    hasCast: !!castPath,
    products: chosen.map((i) => ({ kind: i.kind, description: i.description })),
    holds: held,
    brandRules: kit?.rules ?? "",
    castNote: project.cast_note,
    shotDescription: shot.description,
  });
  const jobId = await queue(db, "remake_still", "nano_banana_pro", {
    project_id: project.id,
    shot_id: shot.id,
    frame_path: shot.frame_path,
    cast_path: castPath,
    product_paths: productPaths,
    prompt,
  });
  await db
    .from("remake_shots")
    .update({ mode: "swap", still_job_id: jobId, still_status: "queued", still_error: null, still_preview_path: null, brand_check: null, approved: false, clip_status: "none", clip_path: null, mixed_status: "none", mixed_path: null })
    .eq("id", shot.id);
  return null;
}

/**
 * Pick the person for every clip from an image that already exists: a UGC
 * Generator result (copied out of the hook-studio bucket) or an upload to
 * remake/<project>/cast/. The still is then generated from the real frame
 * with this person in it; the picked image is never used as the still.
 */
export async function setCastFrom(db: SupabaseClient, project: ProjectRow, source: { ugc_job_id?: string; path?: string }): Promise<string | null> {
  let path: string;
  if (source.ugc_job_id) {
    const { data: job } = await db.from("hook_studio_jobs").select("result_path").eq("id", source.ugc_job_id).eq("kind", "ugc_image").eq("status", "done").maybeSingle();
    const from = job?.result_path as string | undefined;
    if (!from) return "That image is not in the library";
    const { data: blob, error } = await db.storage.from(HOOK_BUCKET).download(from);
    if (error || !blob) return "Could not read the library image";
    const ext = from.split(".").pop() ?? "png";
    path = `remake/${project.id}/cast/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(BOARD_BUCKET).upload(path, blob, { contentType: blob.type || "image/png", upsert: true });
    if (up.error) return up.error.message;
  } else if (source.path && new RegExp(`^remake/${project.id}/cast/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(source.path)) {
    path = source.path;
  } else {
    return "Pick a library image or upload one";
  }
  if (project.cast_path && project.cast_path !== path) await db.storage.from(BOARD_BUCKET).remove([project.cast_path]);
  await db.from("remake_projects").update({ cast_path: path, cast_shot_id: null }).eq("id", project.id);
  return null;
}

/** Voiceover for a b-roll (or any clip): ElevenLabs v4 speaks the script. */
export async function queueVoice(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  if (!shot.script.trim()) return "Write the voiceover line first";
  if (!shot.voice_id || !shot.voice_type) return "Pick a voice first";
  const jobId = await queue(db, "remake_tts", "elevenlabs_v4", {
    project_id: project.id,
    shot_id: shot.id,
    script: shot.script.trim(),
    voice_id: shot.voice_id,
    voice_type: shot.voice_type,
  });
  await db.from("remake_shots").update({ tts_job_id: jobId, audio_status: "queued", audio_error: null, audio_path: null, audio_seconds: null }).eq("id", shot.id);
  return null;
}

export async function queueClip(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  if (shot.mode !== "swap") return "This clip keeps the original; switch it to Swap first";
  if (!shot.still_path || shot.still_status !== "done") return "Make or pick the still first";
  if (!shot.approved) return "Approve the still first";
  const engine = getClipEngine(shot.clip_engine);
  if (!engine) return "Pick a model";
  const seconds = Number(shot.end_s) - Number(shot.start_s);
  const params: Record<string, unknown> = { project_id: project.id, shot_id: shot.id, engine: engine.id, quality: shot.clip_quality, still_path: shot.still_path };
  if (engine.mode === "speak") {
    params.duration = engine.id === "veo3" ? 8 : engine.lengths!.includes(Number(shot.clip_seconds)) ? Number(shot.clip_seconds) : veoLengthFor(seconds);
    params.prompt = veoPrompt({ script: shot.kind === "talking_head" ? shot.script : "", voiceDirection: shot.voice_direction, shotDescription: shot.description, kind: shot.kind });
  } else if (engine.mode === "motion") {
    if (!shot.ref_path) return "The real clip is not cut yet";
    params.ref_path = shot.ref_path;
    params.prompt = motionPrompt(shot.description);
  } else {
    params.duration = Math.min(15, Math.max(3, Math.ceil(seconds)));
    params.prompt = shot.clip_prompt?.trim() || motionPrompt(shot.description);
  }
  const jobId = await queue(db, "remake_clip", engine.id, params);
  await db.from("remake_shots").update({ clip_job_id: jobId, clip_status: "queued", clip_error: null, clip_path: null, mixed_status: "none", mixed_path: null, mixed_key: null }).eq("id", shot.id);
  return null;
}

async function queueMix(db: SupabaseClient, shot: ShotRow, clipPath: string) {
  const key = `${clipPath}|${shot.audio_path}`;
  await queue(db, "remake_mix", "ffmpeg", { project_id: shot.project_id, shot_id: shot.id, clip_path: clipPath, audio_path: shot.audio_path, key });
  await db.from("remake_shots").update({ mixed_status: "queued", mixed_key: key }).eq("id", shot.id);
}

// ─── Timeline edits ───

async function reindex(db: SupabaseClient, projectId: string) {
  const { data } = await db.from("remake_shots").select("id, start_s").eq("project_id", projectId).order("start_s");
  await Promise.all(((data ?? []) as Array<{ id: string }>).map((s, i) => db.from("remake_shots").update({ idx: i }).eq("id", s.id)));
}

/** Split a clip at a time inside it; both halves get a fresh frame and real clip. */
export async function splitShot(db: SupabaseClient, project: ProjectRow, shot: ShotRow, at: number): Promise<string | null> {
  const start = Number(shot.start_s);
  const end = Number(shot.end_s);
  if (!(at - start >= MIN_CLIP_SECONDS && end - at >= MIN_CLIP_SECONDS)) return `Both parts need at least ${MIN_CLIP_SECONDS} s`;
  const t = Math.round(at * 10) / 10;
  await db.from("remake_shots").update({ end_s: t, ref_path: null, mode: shot.mode }).eq("id", shot.id);
  const { data: created, error } = await db
    .from("remake_shots")
    .insert({ project_id: project.id, idx: shot.idx + 1, start_s: t, end_s: end, kind: shot.kind, person: shot.person, mode: shot.mode, selected: shot.selected, brand_heavy: shot.brand_heavy, clip_engine: shot.clip_engine })
    .select("id, idx, start_s, end_s")
    .single();
  if (error || !created) return error?.message ?? "Could not split";
  await reindex(db, project.id);
  await queueFrames(db, project, [{ id: shot.id, idx: shot.idx, start_s: start, end_s: t }, created as ShotRow], true);
  return null;
}

/** Merge a clip with the one after it. Generated work on the second clip is dropped. */
export async function mergeShot(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  const { data: next } = await db.from("remake_shots").select("*").eq("project_id", project.id).gt("start_s", shot.start_s).order("start_s").limit(1).maybeSingle();
  if (!next) return "This is the last clip";
  const n = next as ShotRow;
  const paths = [n.frame_path, n.ref_path, n.still_path, n.audio_path, n.clip_path, n.mixed_path].filter((p): p is string => !!p);
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  await db.from("remake_shots").delete().eq("id", n.id);
  await db.from("remake_shots").update({ end_s: n.end_s, ref_path: null }).eq("id", shot.id);
  await reindex(db, project.id);
  await queueFrames(db, project, [{ id: shot.id, idx: shot.idx, start_s: shot.start_s, end_s: n.end_s }], true);
  return null;
}

/** Throw the clip list away and rebuild it from new cut points (seconds). */
export async function rebuildShots(db: SupabaseClient, project: ProjectRow, cuts: number[]): Promise<string | null> {
  const duration = Number(project.source_duration ?? 0);
  if (!duration) return "The reference has no duration yet";
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration];
  const segs: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < bounds.length; i++) {
    const end = bounds[i];
    const last = i === bounds.length - 1;
    if (end - start < MIN_CLIP_SECONDS && !last) continue;
    if (end - start < MIN_CLIP_SECONDS && segs.length) segs[segs.length - 1][1] = end;
    else segs.push([start, end]);
    start = end;
  }
  const { data: old } = await db.from("remake_shots").select("frame_path, ref_path, still_path, audio_path, clip_path, mixed_path").eq("project_id", project.id);
  const paths = (old ?? []).flatMap((s) => Object.values(s)).filter((p): p is string => typeof p === "string" && p.length > 0);
  for (let i = 0; i < paths.length; i += 100) await db.storage.from(BOARD_BUCKET).remove(paths.slice(i, i + 100));
  await db.from("remake_projects").update({ cast_shot_id: null }).eq("id", project.id);
  await db.from("remake_shots").delete().eq("project_id", project.id);
  const { data: created, error } = await db
    .from("remake_shots")
    .insert(segs.map(([s, e], idx) => ({ project_id: project.id, idx, start_s: Math.round(s * 10) / 10, end_s: Math.round(e * 10) / 10, clip_engine: DEFAULT_CLIP_ENGINE })))
    .select("id, idx, start_s, end_s");
  if (error || !created) return error?.message ?? "Could not rebuild";
  await queueFrames(db, project, created as ShotRow[], true);
  return null;
}

/** Ask Claude where the person or scene changes in the strip, then rebuild. */
export async function redetect(db: SupabaseClient, project: ProjectRow): Promise<string | null> {
  if (!project.strip_path || !project.strip_count) return "No frame strip yet; wait for the first cut to finish";
  const signed = await signBoardPaths(db, [project.strip_path]);
  const url = signed.get(project.strip_path);
  if (!url) return "Could not read the frame strip";
  const cuts = await detectChanges(db, url, project.strip_count);
  if (!cuts) return "Claude could not read the strip (is the Anthropic key set?)";
  if (cuts.length === 0) return "No changes found; the clip list stays as it is";
  return rebuildShots(db, project, cuts);
}

// ─── Passes that run on read (cheap, idempotent, no worker needed) ───

/**
 * After a cut: label the clips once. After a still lands: brand-check it
 * once. When a voiceover and its clip both exist: mix them once. Each flips
 * a status first so two overlapping page loads don't pay twice.
 */
export async function runPendingPasses(db: SupabaseClient, id: string): Promise<void> {
  const { data: row } = await db.from("remake_projects").select("*").eq("id", id).maybeSingle();
  if (!row) return;
  const project = row as ProjectRow;

  if (project.status === "classifying") {
    const { data: locked } = await db.from("remake_projects").update({ status: "ready" }).eq("id", id).eq("status", "classifying").select("id");
    if (locked && locked.length > 0) {
      const { data: shotRows } = await db.from("remake_shots").select("*").eq("project_id", id).is("description", null).order("idx");
      const shots = (shotRows ?? []) as ShotRow[];
      const signed = await signBoardPaths(db, shots.map((s) => s.frame_path));
      const frames = shots.filter((s) => s.frame_path && signed.get(s.frame_path)).map((s) => ({ idx: s.idx, url: signed.get(s.frame_path!)! }));
      const labels = frames.length ? await labelShots(db, frames) : null;
      if (labels) {
        await Promise.all(
          labels.map((l) => {
            const shot = shots.find((s) => s.idx === l.idx);
            if (!shot) return Promise.resolve();
            return db
              .from("remake_shots")
              .update({
                kind: l.kind,
                person: l.person,
                holds: l.holds,
                brand_heavy: l.brand_heavy,
                description: l.description || "—",
                mode: l.brand_heavy ? "keep" : shot.mode,
                // Realism default: b-rolls copy the real motion, talking heads speak the script.
                clip_engine: shot.clip_status === "none" ? DEFAULT_CLIP_ENGINE_FOR[l.kind] : shot.clip_engine,
              })
              .eq("id", shot.id);
          })
        );
      }
    }
  }

  const { data: shotRows } = await db.from("remake_shots").select("*").eq("project_id", id).order("idx");
  const shots = (shotRows ?? []) as ShotRow[];

  // Brand check for stills that came back and were not checked yet.
  const unchecked = shots.filter((s) => s.still_status === "done" && s.still_path && s.brand_check === null).slice(0, 3);
  if (unchecked.length) {
    const kit = await loadBrandKit(db, project.store);
    const signed = await signBoardPaths(db, unchecked.flatMap((s) => [s.still_path, s.still_preview_path]));
    await Promise.all(
      unchecked.map(async (s) => {
        const { data: locked } = await db.from("remake_shots").update({ brand_check: { ok: true, notes: "Checking…" } }).eq("id", s.id).is("brand_check", null).select("id");
        if (!locked || locked.length === 0) return;
        const url = (s.still_preview_path && signed.get(s.still_preview_path)) || signed.get(s.still_path!);
        const result = url ? await brandCheck(db, url, (kit?.images ?? []).map((i) => i.url).filter((u): u is string => !!u), kit?.rules ?? "") : null;
        await db.from("remake_shots").update({ brand_check: result ?? { ok: true, notes: "Not checked: Claude could not read the still (no Anthropic key, or the image is too large)." } }).eq("id", s.id);
      })
    );
  }

  // Mix the voiceover onto the clip it belongs to.
  for (const s of shots) {
    if (s.audio_status !== "done" || !s.audio_path) continue;
    const clipPath = s.mode === "keep" ? s.ref_path : s.clip_status === "done" ? s.clip_path : null;
    if (!clipPath) continue;
    const key = `${clipPath}|${s.audio_path}`;
    if (s.mixed_key === key && (s.mixed_status === "done" || s.mixed_status === "queued" || s.mixed_status === "running")) continue;
    await queueMix(db, s, clipPath);
  }
}
