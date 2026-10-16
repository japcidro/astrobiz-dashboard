import { requireBoardUser } from "@/lib/marketing-board/auth";
import { buildDna } from "@/lib/script-studio/dna";

export const dynamic = "force-dynamic";
// One Opus call over up to 30 deconstructed ads.
export const maxDuration = 300;

/** POST { store } — rebuild the brand's Winning DNA from its deconstructed ads and their purchases. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = b && typeof b.store === "string" ? b.store.trim().slice(0, 80) : "";
  if (!store) return Response.json({ error: "Pick a brand" }, { status: 400 });
  const result = await buildDna(auth.db, store, auth.employee.id);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ dna: result });
}
