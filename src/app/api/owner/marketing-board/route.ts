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
 * POST — pin a reference to the board.
 * Body: { url, kind?: "video" | "image", title?, store?, assignee_id?, due_date?, note? }
 *   or  { upload_path, name?, store? } for an uploaded image (board/images/<uuid>.<ext>)
 *   or  { upload_path, name?, store?, thumb_path?, duration?, width?, height? } for an
 *       uploaded video (board/videos/<uuid>.<ext>), e.g. an ad downloaded from a spy tool
 *       whose link needs a login. The browser grabs the poster frame and the size.
 * Creates the card in "To do", queues the Mac worker to save a copy (a
 * link), and posts the first note (the instructions) when one is given.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { db, employee } = auth;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = typeof b?.store === "string" && b.store.trim() ? b.store.trim().slice(0, 80) : null;
  const assignee = typeof b?.assignee_id === "string" && /^[0-9a-f-]{36}$/.test(b.assignee_id) ? b.assignee_id : null;
  const due = typeof b?.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 4000) : "";

  // An uploaded video: already in the bucket, nothing to fetch, ready to play.
  if (typeof b?.upload_path === "string" && b.upload_path.startsWith("board/videos/")) {
    if (!/^board\/videos\/[0-9a-f-]{36}\.(mp4|mov|webm)$/.test(b.upload_path)) return Response.json({ error: "Bad upload path" }, { status: 400 });
    const thumb = typeof b.thumb_path === "string" && /^board\/thumbs\/[0-9a-f-]{36}\.jpg$/.test(b.thumb_path) ? b.thumb_path : null;
    const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null);
    const duration = num(b.duration, 24 * 3600);
    const width = num(b.width, 10_000);
    const height = num(b.height, 10_000);
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 160) : "Uploaded video";
    const { data, error } = await db
      .from("marketing_board_items")
      .insert({
        kind: "video",
        source_url: "upload",
        source_type: "other",
        title: name,
        video_path: b.upload_path,
        thumb_path: thumb,
        video_status: "ready",
        duration: duration === null ? null : Math.round(duration * 10) / 10,
        width: width === null ? null : Math.round(width),
        height: height === null ? null : Math.round(height),
        store,
        assignee_id: assignee,
        due_date: due,
        created_by: employee.id,
      })
      .select("id")
      .single();
    if (error || !data) return Response.json({ error: error?.message ?? "Could not save" }, { status: 500 });
    if (note) await db.from("marketing_board_comments").insert({ item_id: data.id, author_id: employee.id, body: note });
    return Response.json({ item: await loadItem(db, data.id) });
  }

  // An uploaded image: already in the bucket, nothing to fetch.
  if (typeof b?.upload_path === "string") {
    if (!/^board\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(b.upload_path)) return Response.json({ error: "Bad upload path" }, { status: 400 });
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 160) : "Uploaded image";
    const { data, error } = await db
      .from("marketing_board_items")
      .insert({ kind: "image", source_url: "upload", source_type: "other", title: name, image_path: b.upload_path, video_status: "ready", store, assignee_id: assignee, due_date: due, created_by: employee.id })
      .select("id")
      .single();
    if (error || !data) return Response.json({ error: error?.message ?? "Could not save" }, { status: 500 });
    if (note) await db.from("marketing_board_comments").insert({ item_id: data.id, author_id: employee.id, body: note });
    return Response.json({ item: await loadItem(db, data.id) });
  }

  const url = normalizeUrl(typeof b?.url === "string" ? b.url : "");
  if (!url) return Response.json({ error: "Paste a valid link" }, { status: 400 });
  const kind = b?.kind === "image" ? "image" : "video";

  const info = await describeSource(url);
  const title = typeof b?.title === "string" && b.title.trim() ? b.title.trim().slice(0, 160) : info.title;

  const { data, error } = await db
    .from("marketing_board_items")
    .insert({
      ...info,
      kind,
      title,
      store,
      assignee_id: assignee,
      due_date: due,
      created_by: employee.id,
    })
    .select("id, source_url, kind")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Could not save" }, { status: 500 });

  if (note) {
    await db.from("marketing_board_comments").insert({ item_id: data.id, author_id: employee.id, body: note });
  }
  await queueFetch(db, data);

  return Response.json({ item: await loadItem(db, data.id) });
}
