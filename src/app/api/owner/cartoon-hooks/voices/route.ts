import { requireBoardUser } from "@/lib/marketing-board/auth";
import { listElevenLabsVoices } from "@/lib/cartoon/elevenlabs";

export const dynamic = "force-dynamic";

/** GET — the team's own ElevenLabs voices (FOLIQ and the rest). Higgsfield's voices come from the worker status. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json(await listElevenLabsVoices());
}
