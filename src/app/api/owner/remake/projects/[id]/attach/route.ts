import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — attach every finished clip to the board card as outputs. */
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db, employee } = auth;

  const { data: project } = await db.from("remake_projects").select("board_item_id, title").eq("id", id).maybeSingle();
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  if (!project.board_item_id) return Response.json({ error: "This remake is not linked to a board card" }, { status: 400 });

  const [{ data: shots }, { data: existing }] = await Promise.all([
    db.from("remake_shots").select("idx, clip_path").eq("project_id", id).eq("clip_status", "done").not("clip_path", "is", null).order("idx"),
    db.from("marketing_board_outputs").select("file_path").eq("item_id", project.board_item_id).eq("kind", "upload"),
  ]);
  const have = new Set((existing ?? []).map((o) => o.file_path as string));
  const rows = (shots ?? [])
    .filter((s) => !have.has(s.clip_path as string))
    .map((s) => ({
      item_id: project.board_item_id,
      kind: "upload",
      file_path: s.clip_path,
      note: `${project.title || "Remake"} · shot ${(s.idx as number) + 1}`,
      added_by: employee.id,
    }));
  if (rows.length === 0) return Response.json({ attached: 0 });
  const { error } = await db.from("marketing_board_outputs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ attached: rows.length });
}
