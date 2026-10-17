import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { transcribeBoardItem, transcribeUpload } from "@/lib/script-studio/transcribe";

export const dynamic = "force-dynamic";
// Gemini downloads the video and reads the whole of it; a long reference can take over a minute.
export const maxDuration = 300;

/** POST { item_id } — the script of a board video; POST { path, label? } — the script of a video uploaded to the generator. With timestamps and on-screen text. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const result = isUuid(b.item_id)
    ? await transcribeBoardItem(auth.db, b.item_id)
    : typeof b.path === "string"
      ? await transcribeUpload(auth.db, b.path, typeof b.label === "string" ? b.label : "")
      : { error: "Pick a board video or upload one" };
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json(result);
}
