import { requireBoardUser } from "@/lib/marketing-board/auth";
import { describeSource, normalizeUrl } from "@/lib/marketing-board/sources";
import { loadBoard, loadItem, queueFetch } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

/** GET — the whole board. Polled by the page. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json(await loadBoard(auth.db));
}

/**
 * POST — pin a reference link to the board.
 * Body: { url, title?, store?, assignee_id?, due_date?, note? }
 * Creates the card in "To do", queues the Mac worker to save a copy, and
 * posts the first note (the instructions) when one is given.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { db, employee } = auth;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const url = normalizeUrl(typeof b?.url === "string" ? b.url : "");
  if (!url) return Response.json({ error: "Paste a valid link" }, { status: 400 });

  const info = await describeSource(url);
  const title = typeof b?.title === "string" && b.title.trim() ? b.title.trim().slice(0, 160) : info.title;
  const store = typeof b?.store === "string" && b.store.trim() ? b.store.trim().slice(0, 80) : null;
  const assignee = typeof b?.assignee_id === "string" && /^[0-9a-f-]{36}$/.test(b.assignee_id) ? b.assignee_id : null;
  const due = typeof b?.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 4000) : "";

  const { data, error } = await db
    .from("marketing_board_items")
    .insert({
      ...info,
      title,
      store,
      assignee_id: assignee,
      due_date: due,
      created_by: employee.id,
    })
    .select("id, source_url")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Could not save" }, { status: 500 });

  if (note) {
    await db.from("marketing_board_comments").insert({ item_id: data.id, author_id: employee.id, body: note });
  }
  await queueFetch(db, data);

  return Response.json({ item: await loadItem(db, data.id) });
}
