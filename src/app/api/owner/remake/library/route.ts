import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadPeopleLibrary } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

/** GET — the person library: folders and every person (UGC Generator images and uploads). */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json(await loadPeopleLibrary(auth.db));
}
