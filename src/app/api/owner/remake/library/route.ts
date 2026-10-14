import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadLibraryImages } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

/** GET — finished UGC Generator images, for "use an existing image" as a still. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json({ images: await loadLibraryImages(auth.db) });
}
