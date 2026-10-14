import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { ProjectRow } from "@/lib/remake/types";
import { isUuid, loadProject, redetect } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — re-cut the reference where Claude sees the person or scene change. Replaces the clip list. */
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: project } = await auth.db.from("remake_projects").select("*").eq("id", id).maybeSingle();
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await redetect(auth.db, project as ProjectRow);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  return Response.json({ project: await loadProject(auth.db, id) });
}
