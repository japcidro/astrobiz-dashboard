import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadItem } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/** POST — add a note to a card. Body: { body } */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => null)) as { body?: string } | null;
  const body = typeof b?.body === "string" ? b.body.trim().slice(0, 4000) : "";
  if (!body) return Response.json({ error: "Write a note first" }, { status: 400 });

  const { error } = await auth.db
    .from("marketing_board_comments")
    .insert({ item_id: id, author_id: auth.employee.id, body });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const item = await loadItem(auth.db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}
