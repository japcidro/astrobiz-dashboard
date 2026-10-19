import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { approveAnchor, deleteProject, loadProject, planAndStart } from "@/lib/science-broll/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** GET — one project with its beats, stills, checks and clips. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const project = await loadProject(auth.db, id);
  if (!project || project.kind !== "science") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(project);
}

/** POST — { action: "replan" }: Claude plans the beats again, files replaced. { action: "approve_anchor" }: the stills may be drawn from the anchor. */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { action?: string } | null;
  if (b?.action === "approve_anchor") {
    const problem = await approveAnchor(auth.db, id);
    if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
    return Response.json(await loadProject(auth.db, id));
  }
  if (b?.action !== "replan") return Response.json({ error: "Unknown action" }, { status: 400 });
  const { error } = await auth.db.from("cartoon_hooks").update({ status: "planning", error: null, title: "Planning…" }).eq("id", id).eq("kind", "science");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const db = auth.db;
  after(async () => {
    await planAndStart(db, id);
  });
  return Response.json(await loadProject(db, id));
}

/** DELETE — remove the project, its beats and its files. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await deleteProject(auth.db, id);
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 500 });
  return Response.json({ ok: true });
}
