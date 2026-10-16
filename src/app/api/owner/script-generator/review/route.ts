import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { runPendingReviews } from "@/lib/script-studio/adapt";
import { loadStudioPage } from "@/lib/script-studio/views";

export const dynamic = "force-dynamic";
// Up to four reviews, each possibly followed by one rewrite.
export const maxDuration = 300;

/** POST { item_id?, run_id? } — review finished scripts that have no review yet, then return the runs. The page calls this while any script waits. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  await runPendingReviews(auth.db, isUuid(b.run_id) ? b.run_id : null).catch(() => {});
  const page = await loadStudioPage(auth.db, isUuid(b.item_id) ? b.item_id : null);
  return Response.json({ runs: page.runs });
}
