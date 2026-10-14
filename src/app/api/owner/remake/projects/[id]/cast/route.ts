import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { ProjectRow } from "@/lib/remake/types";
import { isUuid, loadProject, setCastFrom } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST { ugc_job_id } | { path } — pick the person for every clip from an existing image. */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: project } = await auth.db.from("remake_projects").select("*").eq("id", id).maybeSingle();
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const problem = await setCastFrom(auth.db, project as ProjectRow, {
    ugc_job_id: isUuid(body.ugc_job_id) ? body.ugc_job_id : undefined,
    path: typeof body.path === "string" ? body.path : undefined,
  });
  if (problem) return Response.json({ error: problem }, { status: 400 });
  return Response.json({ project: await loadProject(auth.db, id) });
}
