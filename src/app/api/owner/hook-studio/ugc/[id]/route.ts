import { requireOwner } from "@/lib/hook-studio/auth";
import { loadUgcLibrary } from "@/lib/hook-studio/views";
import { HOOK_BUCKET } from "@/lib/hook-studio/storage";
import type { JobRow } from "@/lib/hook-studio/types";

export const dynamic = "force-dynamic";

/**
 * DELETE — remove one UGC result and its file. The source photo is removed
 * too once no other result uses it. Hooks built on it keep working from
 * their own copies of the job params, but their thumbnail goes away.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const { db } = auth;

  const { data } = await db.from("hook_studio_jobs").select("*").eq("id", id).eq("kind", "ugc_image").maybeSingle();
  const job = data as JobRow | null;
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  if (job.status === "running") return Response.json({ error: "Still rendering; wait for it to finish" }, { status: 409 });

  const source = job.params.source_path as string | undefined;
  const toRemove: string[] = [];
  if (job.result_path) toRemove.push(job.result_path);
  if (source) {
    const { count } = await db
      .from("hook_studio_jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "ugc_image")
      .neq("id", id)
      .filter("params->>source_path", "eq", source);
    if ((count ?? 0) === 0) toRemove.push(source);
  }
  if (toRemove.length > 0) await db.storage.from(HOOK_BUCKET).remove(toRemove);

  const { error } = await db.from("hook_studio_jobs").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: await loadUgcLibrary(db) });
}
