import { requireTranscriberAccess } from "@/lib/gemini/transcriber-guard";
import { isValidUploadUrl, uploadChunk } from "@/lib/gemini/transcriber";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel refuses a request body over 4.5MB before this function runs, which is
// why the client slices the video up. Reject anything bigger here too, so an
// oversized chunk fails with our message rather than a platform error page.
const MAX_CHUNK_BYTES = 4.2 * 1024 * 1024;

// POST /api/marketing/transcriber/upload-chunk
// headers: x-upload-url, x-upload-offset, x-upload-last
// body:    raw chunk bytes
//
// Relays one slice of the video into an open Gemini upload session. The
// browser cannot reach Gemini's upload endpoint cross-origin, so every byte
// comes through here; chunking is what keeps each request under the cap.
// Returns the file reference on the final chunk, nothing before that.
export async function POST(request: Request) {
  const gate = await requireTranscriberAccess();
  if (!gate.ok) return gate.response;

  const uploadUrl = request.headers.get("x-upload-url") ?? "";
  const offset = Number(request.headers.get("x-upload-offset"));
  const isLast = request.headers.get("x-upload-last") === "1";

  // The session URL round-trips through the browser, so it is untrusted input
  // pointed at fetch() — it has to be a Gemini upload session and nothing else.
  if (!isValidUploadUrl(uploadUrl)) {
    return Response.json({ error: "Invalid upload session" }, { status: 400 });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return Response.json({ error: "Invalid offset" }, { status: 400 });
  }

  const chunk = await request.arrayBuffer();
  if (chunk.byteLength === 0) {
    return Response.json({ error: "Empty chunk" }, { status: 400 });
  }
  if (chunk.byteLength > MAX_CHUNK_BYTES) {
    return Response.json({ error: "Chunk too large" }, { status: 413 });
  }

  try {
    const file = await uploadChunk(uploadUrl, chunk, offset, isLast);
    return file
      ? Response.json({
          done: true,
          fileUri: file.uri,
          fileName: file.name,
          mimeType: file.mimeType,
        })
      : Response.json({ done: false });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 502 }
    );
  }
}
