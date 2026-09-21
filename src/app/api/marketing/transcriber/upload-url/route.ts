import { requireTranscriberAccess } from "@/lib/gemini/transcriber-guard";
import { MAX_UPLOAD_BYTES, startUploadSession } from "@/lib/gemini/transcriber";

export const dynamic = "force-dynamic";

// POST /api/marketing/transcriber/upload-url
// body: { name: string, mimeType: string, sizeBytes: number }
//
// Mints a Gemini File API resumable-upload session and returns just the
// session URL. The browser then PUTs the video bytes straight to Google, so a
// 200MB mp4 never passes through a Vercel function (4.5MB body cap) and the
// API key never reaches the client.
export async function POST(request: Request) {
  const gate = await requireTranscriberAccess();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  } | null;

  const name = body?.name?.trim();
  const sizeBytes = body?.sizeBytes;
  if (!name || typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return Response.json(
      { error: "name and sizeBytes are required" },
      { status: 400 }
    );
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `${name} is ${(sizeBytes / 1024 / 1024).toFixed(0)}MB — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
      },
      { status: 413 }
    );
  }

  const mimeType = body?.mimeType?.startsWith("video/")
    ? body.mimeType
    : "video/mp4";

  try {
    const uploadUrl = await startUploadSession(
      name,
      mimeType,
      sizeBytes,
      gate.access.apiKey
    );
    return Response.json({ uploadUrl, mimeType });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not start upload" },
      { status: 502 }
    );
  }
}
