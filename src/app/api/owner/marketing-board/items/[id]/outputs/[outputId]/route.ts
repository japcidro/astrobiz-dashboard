import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";
import { loadItem } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; outputId: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/** DELETE — detach an output (and delete its uploaded file). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, outputId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(outputId)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = auth;

  const { data: out } = await db
    .from("marketing_board_outputs")
    .select("file_path")
    .eq("id", outputId)
    .eq("item_id", id)
    .maybeSingle();
  if (!out) return Response.json({ error: "Not found" }, { status: 404 });
  if (out.file_path) await db.storage.from(BOARD_BUCKET).remove([out.file_path]);

  const { error } = await db.from("marketing_board_outputs").delete().eq("id", outputId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const item = await loadItem(db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}
