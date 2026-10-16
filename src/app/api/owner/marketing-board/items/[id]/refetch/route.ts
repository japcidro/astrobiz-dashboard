import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadItem, queueFetch } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/** POST — ask the Mac worker to save the copy again (after a failure). */
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = auth;

  const { data: item } = await db.from("marketing_board_items").select("id, source_url, video_status").eq("id", id).maybeSingle();
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  if (item.video_status === "saving") return Response.json({ error: "Already saving" }, { status: 409 });
  // An uploaded file has no link to fetch from; it is already the saved copy.
  if (item.source_url === "upload") return Response.json({ error: "This reference was uploaded; upload it again instead" }, { status: 400 });

  const { count } = await db
    .from("hook_studio_jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", "board_fetch")
    .in("status", ["queued", "running"])
    .contains("params", { item_id: id });
  if ((count ?? 0) > 0) return Response.json({ error: "Already queued" }, { status: 409 });

  await queueFetch(db, item);
  return Response.json({ item: await loadItem(db, id) });
}
