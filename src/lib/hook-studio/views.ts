import type { SupabaseClient } from "@supabase/supabase-js";
import { signPaths } from "./storage";
import type { Quality } from "./engines";
import type { HookRow, HookView, JobRow, JobView, UgcView } from "./types";

export function toUgcView(j: JobRow, signed: Map<string, string>): UgcView {
  const source = (j.params.source_path as string | undefined) ?? "";
  return {
    id: j.id,
    status: j.status,
    note: (j.params.note as string | undefined) ?? "",
    look: (j.params.look as string | undefined) ?? null,
    source_path: source,
    source_url: source ? signed.get(source) ?? null : null,
    result_path: j.result_path,
    result_url: j.result_path ? signed.get(j.result_path) ?? null : null,
    estimate_credits: j.estimate_credits,
    error: j.error,
    created_at: j.created_at,
    finished_at: j.finished_at,
  };
}

export function toJobView(j: JobRow, signed: Map<string, string>): JobView {
  const { params, ...rest } = j;
  return {
    ...rest,
    engine_id: (params.engine as string | undefined) ?? j.engine,
    quality: (params.quality as Quality | undefined) ?? null,
    duration: typeof params.duration === "number" ? params.duration : null,
    result_url: j.result_path ? signed.get(j.result_path) ?? null : null,
  };
}

/** Every UGC Generator result, newest first. */
export async function loadUgcLibrary(db: SupabaseClient): Promise<UgcView[]> {
  const { data } = await db
    .from("hook_studio_jobs")
    .select("*")
    .eq("kind", "ugc_image")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as JobRow[];
  const signed = await signPaths(db, rows.flatMap((r) => [r.params.source_path as string, r.result_path]));
  return rows.map((r) => toUgcView(r, signed));
}

/** One hook with its UGC image, reference clip and video jobs, paths signed. */
export async function loadHookView(db: SupabaseClient, id: string): Promise<HookView | null> {
  const { data: hook } = await db.from("hook_studio_hooks").select("*").eq("id", id).maybeSingle();
  if (!hook) return null;
  const h = hook as HookRow;

  const [{ data: jobs }, { data: ugcJob }] = await Promise.all([
    db.from("hook_studio_jobs").select("*").eq("hook_id", id).eq("kind", "remake").order("created_at", { ascending: true }),
    h.ugc_job_id
      ? db.from("hook_studio_jobs").select("*").eq("id", h.ugc_job_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const jobRows = (jobs ?? []) as JobRow[];
  const ugcRow = (ugcJob ?? null) as JobRow | null;

  const signed = await signPaths(db, [
    h.reference_path,
    ugcRow?.result_path,
    ugcRow?.params.source_path as string | undefined,
    ...jobRows.map((j) => j.result_path),
  ]);

  return {
    ...h,
    ugc: ugcRow ? toUgcView(ugcRow, signed) : null,
    reference_url: h.reference_path ? signed.get(h.reference_path) ?? null : null,
    jobs: jobRows.map((j) => toJobView(j, signed)),
  };
}
