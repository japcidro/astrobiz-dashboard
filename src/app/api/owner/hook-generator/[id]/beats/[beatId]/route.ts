import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { approveBeat, loadHook, redoClip, redoStill, removeBeat, setLine } from "@/lib/hook-generator/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; beatId: string }> };

/**
 * POST — { action, fix?, line? }:
 *   "approve" / "unapprove": the beat's starting image
 *   "set_line": what the expert says in this beat (a clip made from the old words is made again)
 *   "remove": drop the beat (not once it is animated, and not the last one)
 *   "redo_still": draw the image again, with `fix` (the change in words) when given
 *   "redo_clip": animate the approved image again
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, beatId } = await ctx.params;
  if (!isUuid(id) || !isUuid(beatId)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { action?: string; fix?: unknown; line?: unknown } | null;
  const db = auth.db;
  let problem: string | null;
  if (b?.action === "approve" || b?.action === "unapprove") problem = await approveBeat(db, id, beatId, b.action === "approve");
  else if (b?.action === "redo_still") problem = await redoStill(db, id, beatId, typeof b.fix === "string" ? b.fix : "");
  else if (b?.action === "redo_clip") problem = await redoClip(db, id, beatId);
  else if (b?.action === "set_line") problem = await setLine(db, id, beatId, typeof b.line === "string" ? b.line : "");
  else if (b?.action === "remove") problem = await removeBeat(db, id, beatId);
  else return Response.json({ error: "Unknown action" }, { status: 400 });
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json(await loadHook(db, id));
}
