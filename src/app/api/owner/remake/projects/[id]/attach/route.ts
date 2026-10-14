import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { ShotRow } from "@/lib/remake/types";
import { isUuid } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — attach every finished clip (mixed, ours, or the kept real clip) to the board card as outputs. */
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db, employee } = auth;

  const { data: project } = await db.from("remake_projects").select("board_item_id, title").eq("id", id).maybeSingle();
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  if (!project.board_item_id) return Response.json({ error: "This project is not linked to a board card" }, { status: 400 });

  const [{ data: shots }, { data: existing }] = await Promise.all([
    db.from("remake_shots").select("*").eq("project_id", id).eq("selected", true).order("idx"),
    db.from("marketing_board_outputs").select("file_path").eq("item_id", project.board_item_id).eq("kind", "upload"),
  ]);
  const have = new Set((existing ?? []).map((o) => o.file_path as string));
  const rows = ((shots ?? []) as ShotRow[])
    .map((s) => {
      const path = s.mixed_status === "done" && s.mixed_path ? s.mixed_path : s.mode === "keep" ? s.ref_path : s.clip_status === "done" ? s.clip_path : null;
      return path ? { s, path } : null;
    })
    .filter((x): x is { s: ShotRow; path: string } => !!x && !have.has(x.path))
    .map(({ s, path }) => ({
      item_id: project.board_item_id,
      kind: "upload",
      file_path: path,
      note: `${project.title || "Clipper"} · clip ${s.idx + 1}${s.mode === "keep" ? " (original)" : ""}`,
      added_by: employee.id,
    }));
  if (rows.length === 0) return Response.json({ attached: 0 });
  const { error } = await db.from("marketing_board_outputs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ attached: rows.length });
}
