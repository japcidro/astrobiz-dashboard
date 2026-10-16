import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { transcribeBoardItem } from "@/lib/script-studio/transcribe";

export const dynamic = "force-dynamic";
// Gemini downloads the saved copy and reads the whole video; a long reference can take over a minute.
export const maxDuration = 300;

/** POST { item_id } — the script of a board video, with timestamps and on-screen text. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isUuid(b.item_id)) return Response.json({ error: "Pick a board video" }, { status: 400 });
  const result = await transcribeBoardItem(auth.db, b.item_id);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json(result);
}
