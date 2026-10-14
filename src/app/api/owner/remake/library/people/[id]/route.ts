import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { folder_id: uuid | null } | { name } — move a person into a folder (null = Unsorted) or rename them. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if ("folder_id" in b) {
    if (b.folder_id === null) patch.folder_id = null;
    else if (isUuid(b.folder_id)) patch.folder_id = b.folder_id;
    else return Response.json({ error: "Bad folder" }, { status: 400 });
  }
  if (typeof b.name === "string") patch.name = b.name.trim().slice(0, 120);
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });
  const { data, error } = await auth.db.from("remake_people").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return Response.json({ error: error.code === "23503" ? "That folder no longer exists" : error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
