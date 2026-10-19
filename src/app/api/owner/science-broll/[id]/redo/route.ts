import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { loadProject, redoStep, redoStill } from "@/lib/science-broll/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — { what: "still", beat_id, note? } redraws a beat's still with the note in the prompt (the check and the clip follow);
 * { what: "clip", beat_id } animates the same still again; { what: "character" } redraws the style anchor and every still;
 * { what: "join" } joins the current clips again.
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { what?: string; beat_id?: unknown; note?: unknown } | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const beatId = isUuid(b.beat_id) ? b.beat_id : null;
  let problem: string | null;
  if (b.what === "still") {
    if (!beatId) return Response.json({ error: "Which beat?" }, { status: 400 });
    problem = await redoStill(auth.db, id, beatId, typeof b.note === "string" ? b.note : "");
  } else if (b.what === "clip" || b.what === "character" || b.what === "join") {
    problem = await redoStep(auth.db, id, b.what, beatId);
  } else {
    return Response.json({ error: "Unknown step" }, { status: 400 });
  }
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json(await loadProject(auth.db, id));
}
