import { randomUUID } from "node:crypto";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";

export const dynamic = "force-dynamic";

const IMAGE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** POST { mime } — a one-time signed upload URL for a reference image (hook-generator/refs/<uuid>.<ext>). */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { mime?: string } | null;
  const ext = IMAGE[b?.mime ?? ""];
  if (!ext) return Response.json({ error: "Upload a PNG, JPG or WebP image" }, { status: 400 });
  const { data, error } = await auth.db.storage.from(BOARD_BUCKET).createSignedUploadUrl(`hook-generator/refs/${randomUUID()}.${ext}`);
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  return Response.json({ path: data.path, token: data.token, bucket: BOARD_BUCKET });
}
