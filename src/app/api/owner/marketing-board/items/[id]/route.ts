import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import { BOARD_STATUSES, type BoardStatus } from "@/lib/marketing-board/types";
import { loadItem } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/** GET — one card, refreshed. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const item = await loadItem(auth.db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}

/** PATCH — title, status, store, assignee, due date. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.title === "string") patch.title = b.title.trim().slice(0, 160) || null;
  if (typeof b.store === "string") patch.store = b.store.trim().slice(0, 80) || null;
  if ("assignee_id" in b) {
    if (b.assignee_id === null || b.assignee_id === "") patch.assignee_id = null;
    else if (typeof b.assignee_id === "string" && UUID.test(b.assignee_id)) patch.assignee_id = b.assignee_id;
    else return Response.json({ error: "Unknown assignee" }, { status: 400 });
  }
  if ("due_date" in b) {
    if (b.due_date === null || b.due_date === "") patch.due_date = null;
    else if (typeof b.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) patch.due_date = b.due_date;
    else return Response.json({ error: "Bad date" }, { status: 400 });
  }
  if (typeof b.status === "string") {
    if (!BOARD_STATUSES.includes(b.status as BoardStatus)) return Response.json({ error: "Unknown status" }, { status: 400 });
    patch.status = b.status;
    patch.done_at = b.status === "done" ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const { error } = await auth.db.from("marketing_board_items").update(patch).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const item = await loadItem(auth.db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}

/** DELETE — the card, its notes, outputs and saved files. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = auth;

  const [{ data: item }, { data: outputs }] = await Promise.all([
    db.from("marketing_board_items").select("video_path, thumb_path").eq("id", id).maybeSingle(),
    db.from("marketing_board_outputs").select("file_path").eq("item_id", id),
  ]);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  const paths = [item.video_path, item.thumb_path, ...(outputs ?? []).map((o) => o.file_path)].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  // Pending fetch jobs for this card have nothing to attach to any more.
  await db.from("hook_studio_jobs").update({ status: "canceled" }).eq("kind", "board_fetch").eq("status", "queued").contains("params", { item_id: id });

  const { error } = await db.from("marketing_board_items").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
