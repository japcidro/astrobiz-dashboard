import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { loadStudioPage } from "@/lib/script-studio/views";

export const dynamic = "force-dynamic";

/** GET ?item=<board card> — the generator: the card, brands, Winning DNA per brand, board videos to transcribe, runs with scripts. */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const item = new URL(request.url).searchParams.get("item");
  return Response.json(await loadStudioPage(auth.db, isUuid(item) ? item : null));
}
