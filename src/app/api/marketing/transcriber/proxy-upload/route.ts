import { requireTranscriberAccess } from "@/lib/gemini/transcriber-guard";
import { startUploadSession, uploadBytes } from "@/lib/gemini/transcriber";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel rejects a serverless request body over 4.5MB before our code runs, so
// this fallback is only ever useful for small clips. We stop a little short of
// the platform cap to keep the error ours rather than a raw 413 page.
const PROXY_LIMIT_BYTES = 4 * 1024 * 1024;

// POST /api/marketing/transcriber/proxy-upload  (multipart: file)
//
// Fallback for when the browser cannot upload to Gemini directly — a corporate
// proxy or an extension blocking the cross-origin request. Same destination,
// just relayed through us, which is why it is size-capped.
export async function POST(request: Request) {
  const gate = await requireTranscriberAccess();
  if (!gate.ok) return gate.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > PROXY_LIMIT_BYTES) {
    return Response.json(
      {
        error: `Direct upload to Gemini was blocked, and the relay only handles files up to ${PROXY_LIMIT_BYTES / 1024 / 1024}MB. Check whether an extension or network policy is blocking generativelanguage.googleapis.com.`,
      },
      { status: 413 }
    );
  }

  const mimeType = file.type?.startsWith("video/") ? file.type : "video/mp4";

  try {
    const uploadUrl = await startUploadSession(
      file.name,
      mimeType,
      file.size,
      gate.access.apiKey
    );
    const uploaded = await uploadBytes(uploadUrl, await file.arrayBuffer());
    return Response.json({
      fileUri: uploaded.uri,
      fileName: uploaded.name,
      mimeType: uploaded.mimeType,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 502 }
    );
  }
}
