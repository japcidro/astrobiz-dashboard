import { requireBoardUser } from "@/lib/marketing-board/auth";
import { saveBrief } from "@/lib/script-studio/dna";

export const dynamic = "force-dynamic";

/** PUT { store, brief } — the marketer's standing brief for the brand, read before every run. */
export async function PUT(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = b && typeof b.store === "string" ? b.store.trim().slice(0, 80) : "";
  if (!store) return Response.json({ error: "Pick a brand" }, { status: 400 });
  const brief = b && typeof b.brief === "string" ? b.brief.trim().slice(0, 6000) : "";
  const result = await saveBrief(auth.db, store, brief);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ dna: result });
}
