import { requireBoardUser } from "@/lib/marketing-board/auth";
import { addUploadedPerson, isUuid } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

/** POST { path, name?, folder_id? } — register an uploaded photo (people/<uuid>.<ext>) as a person. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { path?: unknown; name?: unknown; folder_id?: unknown } | null;
  if (typeof b?.path !== "string") return Response.json({ error: "Missing path" }, { status: 400 });
  const folder_id = isUuid(b.folder_id) ? b.folder_id : null;
  const result = await addUploadedPerson(auth.db, { path: b.path, name: typeof b.name === "string" ? b.name : "", folder_id });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.id });
}
