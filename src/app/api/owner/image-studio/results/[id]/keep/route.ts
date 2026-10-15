import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { keepResult } from "@/lib/image-studio/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — keep a result: saved to the board card as an output. */
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await keepResult(auth.db, id, auth.employee.id);
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json({ ok: true });
}
