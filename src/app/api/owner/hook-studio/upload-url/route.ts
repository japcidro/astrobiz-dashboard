import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/hook-studio/auth";
import { HOOK_BUCKET, extensionFor } from "@/lib/hook-studio/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/owner/hook-studio/upload-url
 * Body: { kind: "reference" | "face", mime: string }
 *
 * Reference videos are too big for a Vercel function body, so the browser
 * uploads straight to the bucket with a one-time signed URL from here.
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as { kind?: string; mime?: string } | null;
  const kind = body?.kind;
  const mime = body?.mime ?? "";
  const ext = extensionFor(mime);
  if (kind !== "reference" && kind !== "face") {
    return Response.json({ error: "kind must be reference or face" }, { status: 400 });
  }
  if (!ext) return Response.json({ error: `Unsupported file type ${mime || "(none)"}` }, { status: 400 });
  if (kind === "reference" && !mime.startsWith("video/")) {
    return Response.json({ error: "The reference must be a video (MP4 or MOV)" }, { status: 400 });
  }
  if (kind === "face" && !mime.startsWith("image/")) {
    return Response.json({ error: "A face must be an image" }, { status: 400 });
  }

  const path = `${kind === "reference" ? "refs" : "faces"}/${randomUUID()}.${ext}`;
  const { data, error } = await auth.db.storage.from(HOOK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return Response.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }
  return Response.json({ path: data.path, token: data.token, bucket: HOOK_BUCKET });
}
