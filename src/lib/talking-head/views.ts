import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quality } from "@/lib/hook-studio/engines";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { clipEstimate } from "@/lib/remake/engines";
import { veoPrompt } from "@/lib/remake/prompts";
import type { VoiceGender } from "@/lib/remake/types";
import type { StartingImage, TalkingHeadEngine, TalkingHeadPage, TalkingHeadRow, TalkingHeadView } from "./types";

const UUID = /^[0-9a-f-]{36}$/;

type StillRow = {
  id: string;
  path: string;
  preview_path: string | null;
  title: string;
  source_shot_id: string | null;
  source_project_id: string | null;
  clip_idx: number | null;
  voice_gender: VoiceGender | null;
  voice_profile: string;
  deleted_at: string | null;
  created_at: string;
};

/** Mirror every finished Clipper still into the library (new shots join, regenerated stills refresh their path). Hidden rows stay hidden. */
async function syncClipperStills(db: SupabaseClient): Promise<void> {
  const { data } = await db
    .from("remake_shots")
    .select("id, project_id, idx, still_path, still_preview_path, voice_gender, updated_at, remake_projects!remake_shots_project_id_fkey!inner(title, voice_profile)")
    .eq("still_status", "done")
    .not("still_path", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  type Row = { id: string; project_id: string; idx: number; still_path: string; still_preview_path: string | null; voice_gender: VoiceGender | null; updated_at: string; remake_projects: { title: string; voice_profile: string } | Array<{ title: string; voice_profile: string }> };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return;
  await db.from("talking_head_stills").upsert(
    rows.map((r) => {
      const project = Array.isArray(r.remake_projects) ? r.remake_projects[0] : r.remake_projects;
      return {
        source_shot_id: r.id,
        source_project_id: r.project_id,
        path: r.still_path,
        preview_path: r.still_preview_path,
        title: project?.title || "Untitled",
        clip_idx: r.idx,
        voice_gender: r.voice_gender,
        voice_profile: project?.voice_profile ?? "",
      };
    }),
    { onConflict: "source_shot_id" }
  );
}

/** The library, newest first: Clipper stills and uploads, minus the ones deleted here. */
async function loadStartingImages(db: SupabaseClient): Promise<StartingImage[]> {
  await syncClipperStills(db).catch(() => {});
  const { data } = await db.from("talking_head_stills").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as StillRow[];
  const signed = await signBoardPaths(db, rows.flatMap((r) => [r.path, r.preview_path]));
  const out: StartingImage[] = [];
  for (const r of rows) {
    const url = signed.get(r.path);
    if (!url) continue;
    out.push({
      id: r.id,
      source: r.source_shot_id || r.source_project_id ? "clipper" : "upload",
      source_shot_id: r.source_shot_id,
      project_id: r.source_project_id,
      title: r.title,
      clip_idx: r.clip_idx,
      url,
      preview_url: (r.preview_path && signed.get(r.preview_path)) || url,
      voice_gender: r.voice_gender,
      voice_profile: r.voice_profile,
      created_at: r.created_at,
    });
  }
  return out;
}

/** Register an uploaded photo (talking-heads/library/<uuid>.<ext>) as a starting image. */
export async function addStartingImage(db: SupabaseClient, input: { path: string; name: string; created_by: string | null }): Promise<{ id: string } | { error: string }> {
  if (!/^talking-heads\/library\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(input.path)) return { error: "Bad upload path" };
  const { data, error } = await db
    .from("talking_head_stills")
    .insert({ path: input.path, title: input.name.trim().slice(0, 120) || "Upload", created_by: input.created_by })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not add the image" };
  return { id: data.id as string };
}

/** Remove a starting image: an upload is deleted with its file; a Clipper still is only hidden here. */
export async function deleteStartingImage(db: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await db.from("talking_head_stills").select("*").eq("id", id).maybeSingle();
  if (!data) return "Not found";
  const r = data as StillRow;
  if (r.source_shot_id || r.source_project_id || !r.path.startsWith("talking-heads/library/")) {
    const { error } = await db.from("talking_head_stills").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    return error ? error.message : null;
  }
  await db.storage.from(BOARD_BUCKET).remove([r.path, r.preview_path].filter((p): p is string => !!p));
  const { error } = await db.from("talking_head_stills").delete().eq("id", id);
  return error ? error.message : null;
}

function toView(r: TalkingHeadRow, signed: Map<string, string>): TalkingHeadView {
  return { ...r, still_url: signed.get(r.still_preview_path ?? r.still_path) ?? signed.get(r.still_path) ?? null, clip_url: r.clip_path ? signed.get(r.clip_path) ?? null : null };
}

export async function loadRenders(db: SupabaseClient): Promise<TalkingHeadView[]> {
  const { data } = await db.from("talking_heads").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as TalkingHeadRow[];
  const signed = await signBoardPaths(db, rows.flatMap((r) => [r.still_path, r.still_preview_path, r.clip_path]));
  return rows.map((r) => toView(r, signed));
}

export async function loadTalkingHeadPage(db: SupabaseClient): Promise<TalkingHeadPage> {
  const [stills, renders] = await Promise.all([loadStartingImages(db), loadRenders(db)]);
  return { stills, renders };
}

export interface CreateTalkingHead {
  still_id: string;
  script: string;
  voice_direction: string;
  voice_gender: VoiceGender | null;
  voice_profile: string;
  engine: TalkingHeadEngine;
  quality: Quality;
  seconds: 4 | 6 | 8;
  created_by: string | null;
}

/**
 * Copy the chosen still under talking-heads/ (so it outlives the project),
 * insert the row and queue the Veo job for the Mac worker.
 */
export async function createTalkingHead(db: SupabaseClient, input: CreateTalkingHead): Promise<{ id: string } | { error: string }> {
  if (!UUID.test(input.still_id)) return { error: "Pick a starting image" };
  if (!input.script.trim()) return { error: "Write the script first" };
  const { data: stillRow } = await db.from("talking_head_stills").select("*").eq("id", input.still_id).is("deleted_at", null).maybeSingle();
  if (!stillRow) return { error: "That starting image is gone" };
  const still = stillRow as StillRow;

  const { data: created, error } = await db
    .from("talking_heads")
    .insert({
      still_path: still.path,
      still_preview_path: still.preview_path,
      source_shot_id: still.source_shot_id,
      source_project_id: still.source_project_id,
      source_still_id: still.id,
      title: still.clip_idx !== null ? `${still.title} · clip ${still.clip_idx + 1}` : still.title,
      script: input.script.trim().slice(0, 1500),
      voice_direction: input.voice_direction.trim().slice(0, 120),
      voice_gender: input.voice_gender,
      voice_profile: input.voice_profile.trim().slice(0, 400),
      engine: input.engine,
      quality: input.quality,
      seconds: input.engine === "veo3" ? 8 : input.seconds,
      created_by: input.created_by,
    })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not save" };
  const id = created.id as string;

  // Own copy of the still (and its preview), so deleting the Clipper project later does not break this render.
  const copy = async (from: string, name: string) => {
    const { data: blob, error: dl } = await db.storage.from(BOARD_BUCKET).download(from);
    if (dl || !blob) return null;
    const ext = from.split(".").pop() ?? "png";
    const to = `talking-heads/${id}/${name}.${ext}`;
    const up = await db.storage.from(BOARD_BUCKET).upload(to, blob, { contentType: blob.type || "image/png", upsert: true });
    return up.error ? null : to;
  };
  const [stillPath, previewPath] = await Promise.all([copy(still.path, "still"), still.preview_path ? copy(still.preview_path, "preview") : Promise.resolve(null)]);
  if (!stillPath) {
    await db.from("talking_heads").delete().eq("id", id);
    return { error: "Could not copy the still" };
  }

  const seconds = input.engine === "veo3" ? 8 : input.seconds;
  const prompt = veoPrompt({ script: input.script, voiceDirection: input.voice_direction, shotDescription: null, kind: "talking_head", voiceGender: input.voice_gender, voiceProfile: input.voice_profile });
  const { data: job, error: jobErr } = await db
    .from("hook_studio_jobs")
    .insert({ kind: "talking_head", engine: input.engine, status: "queued", params: { talking_head_id: id, engine: input.engine, quality: input.quality, duration: seconds, prompt, still_path: stillPath } })
    .select("id")
    .single();
  if (jobErr || !job) {
    await db.from("talking_heads").delete().eq("id", id);
    return { error: jobErr?.message ?? "Could not queue the render" };
  }
  await db.from("talking_heads").update({ still_path: stillPath, still_preview_path: previewPath, job_id: job.id as string, credits: clipEstimate(input.engine, input.quality, seconds) }).eq("id", id);
  return { id };
}

/** Remove a render, its files, and cancel its job if it has not started. */
export async function deleteTalkingHead(db: SupabaseClient, id: string): Promise<string | null> {
  const { data: row } = await db.from("talking_heads").select("*").eq("id", id).maybeSingle();
  if (!row) return "Not found";
  const r = row as TalkingHeadRow;
  if (r.job_id) await db.from("hook_studio_jobs").update({ status: "canceled" }).eq("id", r.job_id).eq("status", "queued");
  const paths = [r.still_path, r.still_preview_path, r.clip_path].filter((p): p is string => !!p && p.startsWith("talking-heads/"));
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  const { error } = await db.from("talking_heads").delete().eq("id", id);
  return error ? error.message : null;
}
