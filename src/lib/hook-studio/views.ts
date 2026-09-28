import type { SupabaseClient } from "@supabase/supabase-js";
import { signPaths } from "./storage";
import type { EngineId, Quality } from "./engines";
import type { FaceRow, FaceView, HookRow, HookView, JobRow, JobView } from "./types";

/** Load one hook with its jobs and pinned face, all paths signed. */
export async function loadHookView(db: SupabaseClient, id: string): Promise<HookView | null> {
  const { data: hook } = await db.from("hook_studio_hooks").select("*").eq("id", id).maybeSingle();
  if (!hook) return null;
  const h = hook as HookRow;

  const [{ data: jobs }, { data: face }] = await Promise.all([
    db.from("hook_studio_jobs").select("*").eq("hook_id", id).order("created_at", { ascending: true }),
    h.face_id
      ? db.from("hook_studio_faces").select("*").eq("id", h.face_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const jobRows = (jobs ?? []) as JobRow[];
  const faceRow = (face ?? null) as FaceRow | null;

  const signed = await signPaths(db, [
    h.reference_path,
    faceRow?.image_path,
    ...jobRows.map((j) => j.result_path),
  ]);

  return {
    ...h,
    text_options: Array.isArray(h.text_options) ? h.text_options : [],
    reference_url: h.reference_path ? signed.get(h.reference_path) ?? null : null,
    face: faceRow ? { ...faceRow, image_url: signed.get(faceRow.image_path) ?? null } : null,
    jobs: jobRows.map((j) => toJobView(j, signed)),
  };
}

export function toJobView(j: JobRow, signed: Map<string, string>): JobView {
  const { params, ...rest } = j;
  const engine = (params.engine as EngineId | undefined) ?? (j.kind === "face" ? "soul" : "kling_edit");
  return {
    ...rest,
    engine_id: engine,
    quality: (params.quality as Quality | undefined) ?? null,
    result_url: j.result_path ? signed.get(j.result_path) ?? null : null,
  };
}

export async function loadFaces(db: SupabaseClient): Promise<FaceView[]> {
  const { data } = await db
    .from("hook_studio_faces")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as FaceRow[];
  const signed = await signPaths(db, rows.map((r) => r.image_path));
  return rows.map((r) => ({ ...r, image_url: signed.get(r.image_path) ?? null }));
}
