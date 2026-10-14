import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid, loadProject, loadProjects, queueSplit } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

/** GET — every remake, newest first. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json({ projects: await loadProjects(auth.db) });
}

/**
 * POST — start a remake from a board card's saved copy or an uploaded video.
 * Body: { board_item_id } | { source_path, title? }, plus store?
 * The Mac worker cuts it into shots; Claude labels them on the next load.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { db, employee } = auth;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  let sourcePath: string | null = null;
  let title = typeof b.title === "string" ? b.title.trim().slice(0, 160) : "";
  let store = typeof b.store === "string" && b.store.trim() ? b.store.trim().slice(0, 80) : null;
  let boardItemId: string | null = null;

  if (isUuid(b.board_item_id)) {
    const { data: item } = await db.from("marketing_board_items").select("id, title, store, video_path, video_status").eq("id", b.board_item_id).maybeSingle();
    if (!item) return Response.json({ error: "Board card not found" }, { status: 404 });
    if (!item.video_path || item.video_status !== "ready") return Response.json({ error: "That card has no saved copy yet" }, { status: 400 });
    sourcePath = item.video_path as string;
    boardItemId = item.id as string;
    title = title || ((item.title as string | null) ?? "Remake");
    store = store ?? ((item.store as string | null) ?? null);
  } else if (typeof b.source_path === "string" && /^remake\/sources\/[0-9a-f-]{36}\.(mp4|mov|webm)$/.test(b.source_path)) {
    sourcePath = b.source_path;
    title = title || "Remake";
  } else {
    return Response.json({ error: "Pick a board card or upload a video" }, { status: 400 });
  }

  const { data, error } = await db
    .from("remake_projects")
    .insert({ title, store, board_item_id: boardItemId, source_path: sourcePath, created_by: employee.id })
    .select("id, source_path")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create" }, { status: 500 });
  await queueSplit(db, data);
  return Response.json({ project: await loadProject(db, data.id) });
}
