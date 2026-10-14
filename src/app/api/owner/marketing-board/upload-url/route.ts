import { randomUUID } from "node:crypto";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET, outputExtensionFor } from "@/lib/marketing-board/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * POST { item_id, mime } — a one-time signed URL to upload an output video
 * straight to the bucket (too big for a Vercel function body).
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;

  const b = (await request.json().catch(() => null)) as { item_id?: string; mime?: string } | null;
  const itemId = typeof b?.item_id === "string" && UUID.test(b.item_id) ? b.item_id : null;
  if (!itemId) return Response.json({ error: "Missing item" }, { status: 400 });
  const ext = outputExtensionFor(b?.mime ?? "");
  if (!ext) return Response.json({ error: "Upload an MP4, MOV or WebM video" }, { status: 400 });

  const path = `outputs/${itemId}/${randomUUID()}.${ext}`;
  const { data, error } = await auth.db.storage.from(BOARD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  return Response.json({ path: data.path, token: data.token, bucket: BOARD_BUCKET });
}
