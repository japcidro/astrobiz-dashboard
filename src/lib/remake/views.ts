import type { SupabaseClient } from "@supabase/supabase-js";
import { signBoardPaths } from "@/lib/marketing-board/storage";
import { isLookId } from "@/lib/hook-studio/presets";
import { DEFAULT_CLIP_ENGINE, getClipEngine, isClipEngine, type ClipEngineId } from "./engines";
import { castRecipe, motionPrompt, speakPrompt, stillPrompt } from "./prompts";
import type { BrandImage, BrandKit, ProjectRow, ProjectSummary, ProjectView, ShotRow, ShotView } from "./types";
import { brandCheck, labelShots } from "./vision";

const UUID = /^[0-9a-f-]{36}$/;

// ─── Brand kit ───

export async function loadBrandKit(db: SupabaseClient, store: string | null, signed?: Map<string, string>): Promise<BrandKit | null> {
  if (!store) return null;
  const [{ data: kit }, { data: imgs }] = await Promise.all([
    db.from("remake_brand_kits").select("*").eq("store", store).maybeSingle(),
    db.from("remake_brand_images").select("*").eq("store", store).order("created_at"),
  ]);
  const rows = (imgs ?? []) as Array<Omit<BrandImage, "url">>;
  const s = signed ?? (await signBoardPaths(db, rows.map((r) => r.path)));
  return {
    store,
    rules: (kit?.rules as string | undefined) ?? "",
    images: rows.map((r) => ({ ...r, url: s.get(r.path) ?? null })),
  };
}

// ─── Projects ───

const toShotView = (s: ShotRow, signed: Map<string, string>): ShotView => ({
  ...s,
  frame_url: s.frame_path ? signed.get(s.frame_path) ?? null : null,
  still_url: s.still_path ? signed.get(s.still_path) ?? null : null,
  audio_url: s.audio_path ? signed.get(s.audio_path) ?? null : null,
  clip_url: s.clip_path ? signed.get(s.clip_path) ?? null : null,
  seconds: Math.round((Number(s.end_s) - Number(s.start_s)) * 10) / 10,
});

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
    ...shots.flatMap((s) => [s.frame_path, s.still_path, s.audio_path, s.clip_path]),
    ...((imgs ?? []) as Array<{ path: string }>).map((i) => i.path),
  ]);
  return {
    ...project,
    source_url: signed.get(project.source_path) ?? null,
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
    .select("project_id, idx, frame_path, still_path, clip_status")
    .in("project_id", projects.map((p) => p.id))
    .order("idx");
  const shots = (shotRows ?? []) as Array<Pick<ShotRow, "project_id" | "idx" | "frame_path" | "still_path" | "clip_status">>;
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
      clips_done: mine.filter((s) => s.clip_status === "done").length,
      cover_url: cover ? signed.get(cover) ?? null : null,
      created_at: p.created_at,
    };
  });
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

/** Queue the still for a shot: frame + (cast image) + product photos → Nano Banana Pro. */
export async function queueStill(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  if (!shot.frame_path) return "This shot has no frame yet";
  const kit = await loadBrandKit(db, project.store);
  let castPath: string | null = null;
  if (project.cast_shot_id && project.cast_shot_id !== shot.id) {
    const { data: cast } = await db.from("remake_shots").select("still_path").eq("id", project.cast_shot_id).maybeSingle();
    castPath = (cast?.still_path as string | null) ?? null;
  }
  const productPaths = (kit?.images ?? []).slice(0, 4).map((i) => i.path);
  const look = isLookId(project.cast_look) ? project.cast_look : "varied";
  const prompt = stillPrompt({
    recipe: castRecipe(look),
    hasCast: !!castPath,
    productImages: productPaths.length,
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
    .update({ still_job_id: jobId, still_status: "queued", still_error: null, brand_check: null, approved: false, clip_status: "none", clip_path: null })
    .eq("id", shot.id);
  return null;
}

export async function queueVoice(db: SupabaseClient, project: ProjectRow, shot: ShotRow): Promise<string | null> {
  if (!shot.script.trim()) return "Write the script first";
  if (!shot.voice_id || !shot.voice_type) return "Pick a voice first";
  const jobId = await queue(db, "remake_tts", "text2speech_v2", {
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
  if (!shot.still_path || shot.still_status !== "done") return "Generate the still first";
  if (!shot.approved) return "Approve the still first";
  const engine = getClipEngine(shot.clip_engine);
  if (!engine) return "Pick a model";
  const params: Record<string, unknown> = {
    project_id: project.id,
    shot_id: shot.id,
    engine: engine.id,
    quality: shot.clip_quality,
    still_path: shot.still_path,
  };
  if (engine.mode === "speak") {
    if (!shot.audio_path || shot.audio_status !== "done") return "Generate the voice first";
    params.audio_path = shot.audio_path;
    params.duration = Math.min(engine.maxSeconds, Math.max(engine.minSeconds, Math.ceil(Number(shot.audio_seconds ?? shot.end_s - shot.start_s))));
    params.prompt = speakPrompt(shot.description);
  } else if (engine.mode === "motion") {
    params.source_path = project.source_path;
    params.trim_start = Number(shot.start_s);
    params.trim_end = Number(shot.end_s);
    params.prompt = motionPrompt(shot.description);
  } else {
    params.duration = Math.min(engine.maxSeconds, Math.max(engine.minSeconds, Math.ceil(Number(shot.end_s) - Number(shot.start_s))));
    params.prompt = shot.clip_prompt?.trim() || motionPrompt(shot.description);
  }
  const jobId = await queue(db, "remake_clip", engine.id, params);
  await db.from("remake_shots").update({ clip_job_id: jobId, clip_status: "queued", clip_error: null, clip_path: null }).eq("id", shot.id);
  return null;
}

// ─── Vision passes run on read (cheap, idempotent, no worker needed) ───

/**
 * After the split: label the shots once. After a still lands: brand-check it
 * once. Both flip a status first so two overlapping page loads don't pay twice.
 */
export async function runPendingPasses(db: SupabaseClient, id: string): Promise<void> {
  const { data: row } = await db.from("remake_projects").select("*").eq("id", id).maybeSingle();
  if (!row) return;
  const project = row as ProjectRow;

  if (project.status === "classifying") {
    const { data: locked } = await db.from("remake_projects").update({ status: "ready" }).eq("id", id).eq("status", "classifying").select("id");
    if (locked && locked.length > 0) {
      const { data: shotRows } = await db.from("remake_shots").select("*").eq("project_id", id).order("idx");
      const shots = (shotRows ?? []) as ShotRow[];
      const signed = await signBoardPaths(db, shots.map((s) => s.frame_path));
      const frames = shots.filter((s) => s.frame_path && signed.get(s.frame_path)).map((s) => ({ idx: s.idx, url: signed.get(s.frame_path!)! }));
      const labels = await labelShots(db, frames);
      if (labels) {
        await Promise.all(
          labels.map((l) => {
            const shot = shots.find((s) => s.idx === l.idx);
            if (!shot) return Promise.resolve();
            return db
              .from("remake_shots")
              .update({
                kind: l.kind,
                brand_heavy: l.brand_heavy,
                description: l.description || null,
                selected: !l.brand_heavy,
                clip_engine: DEFAULT_CLIP_ENGINE[l.kind],
              })
              .eq("id", shot.id);
          })
        );
      }
    }
  }

  // Brand check for stills that came back and were not checked yet.
  const { data: unchecked } = await db
    .from("remake_shots")
    .select("*")
    .eq("project_id", id)
    .eq("still_status", "done")
    .is("brand_check", null)
    .not("still_path", "is", null)
    .limit(3);
  const pending = (unchecked ?? []) as ShotRow[];
  if (pending.length === 0) return;
  const kit = await loadBrandKit(db, project.store);
  const signed = await signBoardPaths(db, pending.map((s) => s.still_path));
  await Promise.all(
    pending.map(async (s) => {
      const { data: locked } = await db
        .from("remake_shots")
        .update({ brand_check: { ok: true, notes: "Checking…" } })
        .eq("id", s.id)
        .is("brand_check", null)
        .select("id");
      if (!locked || locked.length === 0) return;
      const url = signed.get(s.still_path!);
      const result = url ? await brandCheck(db, url, (kit?.images ?? []).map((i) => i.url).filter((u): u is string => !!u), kit?.rules ?? "") : null;
      await db
        .from("remake_shots")
        .update({ brand_check: result ?? { ok: true, notes: "Not checked (no Anthropic key or Claude unavailable)." } })
        .eq("id", s.id);
    })
  );
}

// ─── Validation helpers shared by the routes ───

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const asClipEngine = (v: unknown): ClipEngineId | null => (isClipEngine(v) ? v : null);
