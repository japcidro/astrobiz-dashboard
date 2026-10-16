import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { deleteRun } from "@/lib/script-studio/views";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const err = await deleteRun(auth.db, id);
  return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ ok: true });
}
