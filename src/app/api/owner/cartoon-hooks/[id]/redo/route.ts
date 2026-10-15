import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { loadHook, redo, type Redo } from "@/lib/cartoon/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STEPS: Redo[] = ["still", "clip", "voice", "character", "join"];

/** POST — { what: "still" | "clip" | "voice" | "character" | "join", beat_id? }: make that step again (and what depends on it). */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { what?: string; beat_id?: unknown } | null;
  if (!b || !STEPS.includes(b.what as Redo)) return Response.json({ error: "Unknown step" }, { status: 400 });
  const problem = await redo(auth.db, id, b.what as Redo, isUuid(b.beat_id) ? b.beat_id : null);
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json(await loadHook(auth.db, id));
}
