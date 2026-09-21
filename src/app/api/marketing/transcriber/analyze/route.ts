import { requireTranscriberAccess } from "@/lib/gemini/transcriber-guard";
import {
  analyzeVideoFile,
  deleteGeminiFile,
  waitUntilActive,
} from "@/lib/gemini/transcriber";

export const dynamic = "force-dynamic";
// Gemini pre-processing plus a full transcript + audio analysis on a long clip
// runs into minutes. Take the whole budget.
export const maxDuration = 300;

// POST /api/marketing/transcriber/analyze
// body: { fileUri: string, fileName: string, mimeType?: string }
//
// Runs after the browser has uploaded the video to Gemini's File API. Waits
// for the file to finish pre-processing, asks for the transcript + voice-tone
// + music breakdown, then deletes the upload.
export async function POST(request: Request) {
  const gate = await requireTranscriberAccess();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    fileUri?: string;
    fileName?: string;
    mimeType?: string;
  } | null;

  const fileUri = body?.fileUri;
  const fileName = body?.fileName;
  if (!fileUri || !fileName) {
    return Response.json(
      { error: "fileUri and fileName are required" },
      { status: 400 }
    );
  }
  // fileName goes straight into a Gemini URL path — only ever "files/<id>".
  if (!/^files\/[A-Za-z0-9_-]+$/.test(fileName)) {
    return Response.json({ error: "Invalid fileName" }, { status: 400 });
  }

  const { apiKey } = gate.access;

  try {
    const activeMime = await waitUntilActive(fileName, apiKey);
    const out = await analyzeVideoFile(
      fileUri,
      body?.mimeType?.startsWith("video/") ? body.mimeType : activeMime,
      apiKey
    );
    return Response.json(out);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Transcription failed",
      },
      { status: 502 }
    );
  } finally {
    // The analysis is already in the response; the upload has no further use.
    void deleteGeminiFile(fileName, apiKey);
  }
}
