import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quality } from "@/lib/hook-studio/engines";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { clipEstimate } from "@/lib/remake/engines";
import { veoPrompt } from "@/lib/remake/prompts";
import type { VoiceGender } from "@/lib/remake/types";
import type { StartingImage, TalkingHeadEngine, TalkingHeadPage, TalkingHeadRow, TalkingHeadView } from "./types";

const UUID = /^[0-9a-f-]{36}$/;

/** Every finished Clipper still, newest first, with the project it belongs to. */
async function loadStartingImages(db: SupabaseClient): Promise<StartingImage[]> {
  const { data } = await db
    .from("remake_shots")
    .select("id, project_id, idx, still_path, still_preview_path, voice_gender, created_at, updated_at, remake_projects!inner(title, voice_profile)")
    .eq("still_status", "done")
    .not("still_path", "is", null)
    .order("updated_at", { ascending: false })
    .limit(400);
  type Row = { id: string; project_id: string; idx: number; still_path: string; still_preview_path: string | null; voice_gender: VoiceGender | null; created_at: string; updated_at: string; remake_projects: { title: string; voice_profile: string } | Array<{ title: string; voice_profile: string }> };
  const rows = (data ?? []) as unknown as Row[];
  const signed = await signBoardPaths(db, rows.flatMap((r) => [r.still_path, r.still_preview_path]));
  const out: StartingImage[] = [];
  for (const r of rows) {
    const url = signed.get(r.still_path);
    if (!url) continue;
    const project = Array.isArray(r.remake_projects) ? r.remake_projects[0] : r.remake_projects;
    out.push({
      shot_id: r.id,
      project_id: r.project_id,
      project_title: project?.title || "Untitled",
      clip_idx: r.idx,
      url,
      preview_url: (r.still_preview_path && signed.get(r.still_preview_path)) || url,
      voice_gender: r.voice_gender,
      voice_profile: project?.voice_profile ?? "",
      created_at: r.updated_at,
    });
  }
  return out;
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
  shot_id: string;
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
  if (!UUID.test(input.shot_id)) return { error: "Pick a starting image" };
  if (!input.script.trim()) return { error: "Write the script first" };
  const { data: shot } = await db.from("remake_shots").select("id, idx, project_id, still_path, still_preview_path, still_status").eq("id", input.shot_id).maybeSingle();
  if (!shot || shot.still_status !== "done" || !shot.still_path) return { error: "That still is not ready" };
  const { data: project } = await db.from("remake_projects").select("title").eq("id", shot.project_id as string).maybeSingle();

  const { data: created, error } = await db
    .from("talking_heads")
    .insert({
      still_path: shot.still_path,
      still_preview_path: shot.still_preview_path,
      source_shot_id: shot.id,
      source_project_id: shot.project_id,
      title: `${(project?.title as string | undefined) || "Untitled"} · clip ${Number(shot.idx) + 1}`,
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
  const [stillPath, previewPath] = await Promise.all([copy(shot.still_path as string, "still"), shot.still_preview_path ? copy(shot.still_preview_path as string, "preview") : Promise.resolve(null)]);
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
