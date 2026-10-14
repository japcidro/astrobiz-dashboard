import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import { isLookId } from "@/lib/hook-studio/presets";
import { isUuid, loadProject, runPendingPasses } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the project with shots; also runs the labelling / brand-check passes that are due. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  await runPendingPasses(auth.db, id).catch(() => {});
  const project = await loadProject(auth.db, id);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project });
}

/** PATCH — title, store, cast look / note, cast shot. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.title === "string") patch.title = b.title.trim().slice(0, 160);
  if ("store" in b) patch.store = typeof b.store === "string" && b.store.trim() ? b.store.trim().slice(0, 80) : null;
  if (typeof b.cast_look === "string") {
    if (!isLookId(b.cast_look)) return Response.json({ error: "Unknown look" }, { status: 400 });
    patch.cast_look = b.cast_look;
  }
  if (typeof b.cast_note === "string") patch.cast_note = b.cast_note.trim().slice(0, 400);
  if ("cast_shot_id" in b) {
    if (b.cast_shot_id === null) patch.cast_shot_id = null;
    else if (isUuid(b.cast_shot_id)) {
      const { data: shot } = await auth.db.from("remake_shots").select("id, still_status").eq("id", b.cast_shot_id).eq("project_id", id).maybeSingle();
      if (!shot || shot.still_status !== "done") return Response.json({ error: "That shot has no finished still" }, { status: 400 });
      patch.cast_shot_id = shot.id;
    } else return Response.json({ error: "Bad cast shot" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const { error } = await auth.db.from("remake_projects").update(patch).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: await loadProject(auth.db, id) });
}

/** DELETE — the project, its shots and every generated file. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = auth;

  const [{ data: project }, { data: shots }] = await Promise.all([
    db.from("remake_projects").select("source_path, board_item_id").eq("id", id).maybeSingle(),
    db.from("remake_shots").select("frame_path, still_path, audio_path, clip_path").eq("project_id", id),
  ]);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const paths = (shots ?? [])
    .flatMap((s) => [s.frame_path, s.still_path, s.audio_path, s.clip_path])
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  // Uploaded sources belong to this project; board copies belong to the card.
  if (!project.board_item_id && typeof project.source_path === "string" && project.source_path.startsWith("remake/sources/")) paths.push(project.source_path);
  for (let i = 0; i < paths.length; i += 100) await db.storage.from(BOARD_BUCKET).remove(paths.slice(i, i + 100));
  await db.from("hook_studio_jobs").update({ status: "canceled" }).eq("status", "queued").contains("params", { project_id: id });

  const { error } = await db.from("remake_projects").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
