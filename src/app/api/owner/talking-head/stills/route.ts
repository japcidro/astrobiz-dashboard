import { requireBoardUser } from "@/lib/marketing-board/auth";
import { addStartingImage, loadTalkingHeadPage } from "@/lib/talking-head/views";

export const dynamic = "force-dynamic";

/** POST { path, name? } — register an uploaded photo (talking-heads/library/<uuid>.<ext>) as a starting image. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { path?: unknown; name?: unknown } | null;
  if (typeof b?.path !== "string") return Response.json({ error: "Missing path" }, { status: 400 });
  const result = await addStartingImage(auth.db, { path: b.path, name: typeof b.name === "string" ? b.name : "", created_by: auth.employee.id });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.id, stills: (await loadTalkingHeadPage(auth.db)).stills });
}
