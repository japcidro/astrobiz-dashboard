import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { deleteRun } from "@/lib/image-studio/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE — remove a run and its images; queued renders are canceled. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await deleteRun(auth.db, id);
  if (problem) return Response.json({ error: problem }, { status: 500 });
  return Response.json({ ok: true });
}
