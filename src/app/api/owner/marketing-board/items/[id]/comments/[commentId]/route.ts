import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadItem } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; commentId: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/** DELETE — remove a note. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, commentId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(commentId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { error } = await auth.db.from("marketing_board_comments").delete().eq("id", commentId).eq("item_id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const item = await loadItem(auth.db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}
