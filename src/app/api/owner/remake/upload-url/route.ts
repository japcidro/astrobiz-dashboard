import { randomUUID } from "node:crypto";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { BOARD_BUCKET } from "@/lib/marketing-board/storage";

export const dynamic = "force-dynamic";

const VIDEO: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
const IMAGE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const UUID = /^[0-9a-f-]{36}$/;

/**
 * POST { kind, mime, … } — a one-time signed upload URL.
 *   kind "source": a reference video
 *   kind "brand" + store: a product photo for the brand kit
 *   kind "cast" + project_id: the person to put into every clip
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { kind?: string; mime?: string; store?: string; project_id?: string; shot_id?: string } | null;
  const mime = b?.mime ?? "";
  let path: string;
  if (b?.kind === "source") {
    const ext = VIDEO[mime];
    if (!ext) return Response.json({ error: "Upload an MP4, MOV or WebM video" }, { status: 400 });
    path = `remake/sources/${randomUUID()}.${ext}`;
  } else if (b?.kind === "brand") {
    const ext = IMAGE[mime];
    const store = typeof b.store === "string" ? b.store.trim().replace(/[^a-z0-9 _-]/gi, "").slice(0, 80) : "";
    if (!ext) return Response.json({ error: "Upload a PNG, JPG or WebP photo" }, { status: 400 });
    if (!store) return Response.json({ error: "Pick a store first" }, { status: 400 });
    path = `brand/${store}/${randomUUID()}.${ext}`;
  } else if (b?.kind === "cast") {
    const ext = IMAGE[mime];
    if (!ext) return Response.json({ error: "Upload a PNG, JPG or WebP image" }, { status: 400 });
    if (!UUID.test(b.project_id ?? "")) return Response.json({ error: "Missing project" }, { status: 400 });
    path = `remake/${b.project_id}/cast/${randomUUID()}.${ext}`;
  } else {
    return Response.json({ error: "kind must be source, brand or cast" }, { status: 400 });
  }
  const { data, error } = await auth.db.storage.from(BOARD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  return Response.json({ path: data.path, token: data.token, bucket: BOARD_BUCKET });
}
