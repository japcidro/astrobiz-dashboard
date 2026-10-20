import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import type { CartoonResolution } from "@/lib/cartoon/types";
import { LOOKS, type LookId } from "@/lib/science-broll/engines";
import { createProjects, loadProjects, planAndStart } from "@/lib/science-broll/views";

export const dynamic = "force-dynamic";
// Claude plans every take after the response goes out.
export const maxDuration = 300;

/** GET — every science b-roll project, newest first. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json({ projects: await loadProjects(auth.db) });
}

/** POST — { text, direction?, brand?, look?, resolution?, variants?, batch_id? }: rows saved in "planning" and returned at once; Claude plans them in the background and the Mac worker takes over. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const result = await createProjects(auth.db, {
    text: str(b.text),
    direction: str(b.direction),
    brand: str(b.brand),
    look: LOOKS.some((l) => l.id === b.look) ? (b.look as LookId) : "cinematic",
    resolution: (b.resolution === "720p" ? "720p" : "480p") as CartoonResolution,
    variants: typeof b.variants === "number" ? b.variants : 1,
    batch_id: isUuid(b.batch_id) ? b.batch_id : null,
    created_by: auth.employee.id,
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  const db = auth.db;
  after(async () => {
    await Promise.all(result.ids.map((id) => planAndStart(db, id)));
  });
  return Response.json({ ids: result.ids, projects: await loadProjects(db) });
}
