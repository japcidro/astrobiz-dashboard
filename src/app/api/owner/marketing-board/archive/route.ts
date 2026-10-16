import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadArchive } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * GET — one page of the Archive: Done cards finished more than
 * ARCHIVE_AFTER_HOURS ago. Query: kind=video|image, assignee=<uuid>,
 * store=<name>, q=<title search>, offset=<n>.
 */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const p = new URL(request.url).searchParams;
  const assignee = p.get("assignee");
  try {
    return Response.json(
      await loadArchive(auth.db, {
        kind: p.get("kind") === "image" ? "image" : "video",
        assignee: assignee && UUID.test(assignee) ? assignee : null,
        store: p.get("store")?.trim().slice(0, 80) || null,
        q: p.get("q")?.trim().slice(0, 120) || null,
        offset: Number(p.get("offset")) || 0,
      })
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load the archive" }, { status: 500 });
  }
}
