import { requireOwner } from "@/lib/hook-studio/auth";
import { loadFaces } from "@/lib/hook-studio/views";
import type { JobRow } from "@/lib/hook-studio/types";

export const dynamic = "force-dynamic";

/** GET — pinned faces, newest first. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  return Response.json({ faces: await loadFaces(auth.db) });
}

/**
 * POST — pin a face.
 * Body: { job_id, name? }            a finished Soul 2 candidate
 *   or  { image_path, name? }        an uploaded photo (path from upload-url)
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { job_id?: string; image_path?: string; name?: string } | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  let imagePath: string | null = null;
  let source: "soul" | "upload" = "upload";
  let creator: string | null = null;

  if (b.job_id) {
    const { data } = await auth.db.from("hook_studio_jobs").select("*").eq("id", b.job_id).maybeSingle();
    const job = data as JobRow | null;
    if (!job || job.kind !== "face" || job.status !== "done" || !job.result_path) {
      return Response.json({ error: "That face is not ready" }, { status: 400 });
    }
    imagePath = job.result_path;
    source = "soul";
    creator = (job.params.creator as string | undefined) ?? null;
  } else if (typeof b.image_path === "string" && /^faces\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(b.image_path)) {
    imagePath = b.image_path;
  }
  if (!imagePath) return Response.json({ error: "Nothing to pin" }, { status: 400 });

  const { count } = await auth.db.from("hook_studio_faces").select("id", { count: "exact", head: true });
  const name = (b.name ?? "").trim().slice(0, 60) || `Face ${(count ?? 0) + 1}`;
  const { data, error } = await auth.db
    .from("hook_studio_faces")
    .insert({ name, image_path: imagePath, source, creator })
    .select("id")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  return Response.json({ id: data.id, faces: await loadFaces(auth.db) });
}

/** DELETE — unpin a face. Body: { id } */
export async function DELETE(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id) return Response.json({ error: "id required" }, { status: 400 });
  const { error } = await auth.db.from("hook_studio_faces").delete().eq("id", b.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ faces: await loadFaces(auth.db) });
}
