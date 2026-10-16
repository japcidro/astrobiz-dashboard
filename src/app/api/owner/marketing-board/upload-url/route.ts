import { randomUUID } from "node:crypto";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET, outputExtensionFor } from "@/lib/marketing-board/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

const IMAGE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * POST { item_id, mime } — a one-time signed URL to upload an output video
 * straight to the bucket (too big for a Vercel function body).
 * POST { kind: "image", mime } — an image reference for an image card (board/images/).
 * POST { kind: "video", mime } — a downloaded reference ad for a video card (board/videos/).
 * POST { kind: "thumb", mime: "image/jpeg" } — that video's poster frame, grabbed in the browser (board/thumbs/).
 * POST { kind: "studio", mime } — an attachment for the Static Ad Generator (image-studio/uploads/).
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;

  const b = (await request.json().catch(() => null)) as { item_id?: string; mime?: string; kind?: string } | null;
  let path: string;
  if (b?.kind === "video") {
    const ext = outputExtensionFor(b.mime ?? "");
    if (!ext) return Response.json({ error: "Upload an MP4, MOV or WebM video" }, { status: 400 });
    path = `board/videos/${randomUUID()}.${ext}`;
  } else if (b?.kind === "thumb") {
    if (b.mime !== "image/jpeg") return Response.json({ error: "Thumbnails are JPEG" }, { status: 400 });
    path = `board/thumbs/${randomUUID()}.jpg`;
  } else if (b?.kind === "image" || b?.kind === "studio") {
    const ext = IMAGE[b.mime ?? ""];
    if (!ext) return Response.json({ error: "Upload PNG, JPG or WebP images" }, { status: 400 });
    path = b.kind === "image" ? `board/images/${randomUUID()}.${ext}` : `image-studio/uploads/${randomUUID()}.${ext}`;
  } else {
    const itemId = typeof b?.item_id === "string" && UUID.test(b.item_id) ? b.item_id : null;
    if (!itemId) return Response.json({ error: "Missing item" }, { status: 400 });
    const ext = outputExtensionFor(b?.mime ?? "");
    if (!ext) return Response.json({ error: "Upload an MP4, MOV or WebM video" }, { status: 400 });
    path = `outputs/${itemId}/${randomUUID()}.${ext}`;
  }
  const { data, error } = await auth.db.storage.from(BOARD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  return Response.json({ path: data.path, token: data.token, bucket: BOARD_BUCKET });
}
