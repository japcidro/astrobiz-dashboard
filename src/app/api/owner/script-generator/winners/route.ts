import { requireBoardUser } from "@/lib/marketing-board/auth";
import { refreshWinners, transcribeWinner } from "@/lib/script-studio/winners";

export const dynamic = "force-dynamic";
// Transcribing one ad downloads its video and has Gemini read it.
export const maxDuration = 300;

/** POST { store, refresh? } rebuilds the brand's winners list when stale (or forced); { store, ad_id } transcribes one winner. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = b && typeof b.store === "string" ? b.store.trim().slice(0, 80) : "";
  if (!store) return Response.json({ error: "Pick a brand" }, { status: 400 });
  const adId = b && typeof b.ad_id === "string" && /^\d{5,30}$/.test(b.ad_id) ? b.ad_id : null;
  const result = adId ? await transcribeWinner(auth.db, store, adId) : await refreshWinners(auth.db, store, b?.refresh === true);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ winners: result });
}
