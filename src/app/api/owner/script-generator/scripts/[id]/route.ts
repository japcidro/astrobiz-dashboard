import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { rewriteScript } from "@/lib/script-studio/adapt";
import { keepScript } from "@/lib/script-studio/views";

export const dynamic = "force-dynamic";
// A rewrite is one Opus call.
export const maxDuration = 300;

/** POST { action: "keep" } puts the script in the board card's notes; { action: "rewrite", note } writes it again with the note. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.action === "keep") {
    const err = await keepScript(auth.db, id, auth.employee.id);
    return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ ok: true });
  }
  if (b.action === "rewrite") {
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    if (!note) return Response.json({ error: "Say what should change" }, { status: 400 });
    const err = await rewriteScript(auth.db, id, note);
    return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
