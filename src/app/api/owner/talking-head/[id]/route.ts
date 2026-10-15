import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { deleteTalkingHead, loadRenders } from "@/lib/talking-head/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE — remove a render and its files; a queued job is canceled. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await deleteTalkingHead(auth.db, id);
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 500 });
  return Response.json({ renders: await loadRenders(auth.db) });
}
