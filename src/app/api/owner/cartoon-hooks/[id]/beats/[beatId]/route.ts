import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { loadHook, updateBeat } from "@/lib/cartoon/views";
import type { BeatStyle } from "@/lib/cartoon/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; beatId: string }> };

const STYLES: BeatStyle[] = ["pixar3d", "flat2d", "medical"];

/** PATCH — edit a beat: { line?, seconds?, scene?, motion?, style?, uses_character? }. Use redo to remake its image or clip. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, beatId } = await ctx.params;
  if (!isUuid(id) || !isUuid(beatId)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const problem = await updateBeat(auth.db, beatId, {
    line: typeof b.line === "string" ? b.line : undefined,
    seconds: typeof b.seconds === "number" ? b.seconds : undefined,
    scene: typeof b.scene === "string" ? b.scene : undefined,
    motion: typeof b.motion === "string" ? b.motion : undefined,
    style: STYLES.includes(b.style as BeatStyle) ? (b.style as BeatStyle) : undefined,
    uses_character: typeof b.uses_character === "boolean" ? b.uses_character : undefined,
  });
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json(await loadHook(auth.db, id));
}
