import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name } — rename a folder. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) return Response.json({ error: "Give the folder a name" }, { status: 400 });
  const { data, error } = await auth.db.from("remake_people_folders").update({ name }).eq("id", id).select("*").maybeSingle();
  if (error) return Response.json({ error: error.code === "23505" ? "A folder with that name already exists" : error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ folder: data });
}

/** DELETE — remove an empty folder. People inside it block the delete. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { count } = await auth.db.from("remake_people").select("id", { count: "exact", head: true }).eq("folder_id", id);
  if (count && count > 0) return Response.json({ error: `Move the ${count} ${count === 1 ? "person" : "people"} out of this folder first` }, { status: 400 });
  const { error } = await auth.db.from("remake_people_folders").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
