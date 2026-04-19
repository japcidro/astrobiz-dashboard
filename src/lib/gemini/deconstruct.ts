const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

// Inline vs File API threshold. Gemini's documented inline cap is 20MB;
// we keep a buffer. Anything above this goes through the File API,
// which supports up to 2GB per file.
const INLINE_THRESHOLD_BYTES = 18 * 1024 * 1024;
// Hard cap on any video (File API also has per-file limits and very large
// videos hit Gemini's token budget). 400MB is well past typical ads and
// leaves room under Vercel function memory on Fluid Compute.
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
// Abort video download if Facebook is slow.
const DOWNLOAD_TIMEOUT_MS = 90_000;
// Poll the File API this long waiting for the upload to become ACTIVE.
const FILE_ACTIVATION_TIMEOUT_MS = 90_000;
const FILE_POLL_INTERVAL_MS = 2_000;

export interface AdDeconstruction {
  transcript: string;
  hook: {
    description: string;
    timestamp: string;
  };
  scenes: Array<{
    t: string;
    description: string;
  }>;
  visual_style: string;
  tone: string;
  cta: string;
  language: string;
  duration_seconds: number;
}

export interface DeconstructResult {
  analysis: AdDeconstruction;
  model: string;
  tokens_used: number | null;
  size_bytes: number;
  mime_type: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: {
      type: "STRING",
      description:
        "Verbatim word-for-word transcript of all spoken audio and visible text overlays. Include on-screen text captions in brackets like [ON-SCREEN: '50% OFF'].",
    },
    hook: {
      type: "OBJECT",
      description: "Analysis of the first 3 seconds (the hook).",
      properties: {
        description: {
          type: "STRING",
          description:
            "What happens in 0-3 seconds to grab attention. Mention visual + audio + text.",
        },
        timestamp: { type: "STRING", description: "e.g. '0:00-0:03'" },
      },
      required: ["description", "timestamp"],
    },
    scenes: {
      type: "ARRAY",
      description:
        "List of notable scene / b-roll changes with timestamps. Note every major cut or visual shift.",
      items: {
        type: "OBJECT",
        properties: {
          t: { type: "STRING", description: "Timestamp, e.g. '0:07'" },
          description: {
            type: "STRING",
            description:
              "One-sentence description of the scene change and what is shown.",
          },
        },
        required: ["t", "description"],
      },
    },
    visual_style: {
      type: "STRING",
      description:
        "Overall visual style: UGC vs studio vs animation, pacing (fast/slow cuts), use of text overlays, color grading, camera style (phone/DSLR/drone).",
    },
    tone: {
      type: "STRING",
      description:
        "Tone / emotion: urgent, relatable, educational, testimonial, problem-agitation-solution, etc.",
    },
    cta: {
      type: "STRING",
      description:
        "How the CTA is delivered: when it appears, spoken vs text, what action is asked for.",
    },
    language: {
      type: "STRING",
      description: "Primary language(s) used, e.g. 'Tagalog', 'English + Tagalog'.",
    },
    duration_seconds: {
      type: "NUMBER",
      description: "Approximate duration of the video in seconds.",
    },
  },
  required: [
    "transcript",
    "hook",
    "scenes",
    "visual_style",
    "tone",
    "cta",
    "language",
    "duration_seconds",
  ],
};

const SYSTEM_INSTRUCTION = `You are an expert performance-marketing creative analyst for a Philippine e-commerce brand. You will watch a Facebook/Meta ad video and produce a structured deconstruction that a media buyer and a creative strategist can use to replicate what works.

Be precise and observational. Do not add marketing commentary or suggestions — just describe what is actually in the video. Use Philippine context when relevant (Tagalog/Taglish is common).

If you cannot identify audio (muted segment), state that explicitly. Do not hallucinate transcript content.`;

async function downloadVideo(
  videoUrl: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(videoUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Video download failed: ${res.status} ${res.statusText}`
      );
    }
    const mimeType = res.headers.get("content-type") ?? "video/mp4";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      throw new Error(
        `Video too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, max ${MAX_VIDEO_BYTES / 1024 / 1024}MB).`
      );
    }
    return { buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Node's Buffer handles arbitrary byte chunks without call-stack issues,
  // unlike String.fromCharCode(...bytes).
  return Buffer.from(bytes).toString("base64");
}

interface UploadedFile {
  uri: string;
  mimeType: string;
  name: string;
}

// Uploads a video to Gemini's File API using the resumable upload protocol.
// Returns the fileUri that can be referenced in generateContent and polls
// until the file reaches ACTIVE state (Gemini pre-processes video before
// it can be used in a prompt).
async function uploadToFileApi(
  buffer: ArrayBuffer,
  mimeType: string,
  apiKey: string
): Promise<UploadedFile> {
  const effectiveMime = mimeType.startsWith("video/") ? mimeType : "video/mp4";
  const size = buffer.byteLength;

  // 1. Start the resumable upload session.
  const startRes = await fetch(
    `${GEMINI_API_BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": effectiveMime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { display_name: `ad-${Date.now()}` },
      }),
    }
  );
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(
      `File API start failed (${startRes.status}): ${text.slice(0, 200)}`
    );
  }
  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new Error("File API did not return an upload URL");
  }

  // 2. Upload the bytes and finalize in one request.
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(
      `File API upload failed (${uploadRes.status}): ${text.slice(0, 200)}`
    );
  }
  const uploadJson = (await uploadRes.json()) as {
    file?: { uri?: string; name?: string; mimeType?: string; state?: string };
  };
  const initialFile = uploadJson.file ?? {};
  if (!initialFile.uri || !initialFile.name) {
    throw new Error("File API returned no uri");
  }

  // 3. Poll until ACTIVE. Gemini runs video pre-processing before allowing
  //    the file in a prompt; for large videos this can take 10-60s.
  const fileName = initialFile.name;
  const deadline = Date.now() + FILE_ACTIVATION_TIMEOUT_MS;
  let state = initialFile.state ?? "PROCESSING";
  let mimeOut = initialFile.mimeType ?? effectiveMime;

  while (state !== "ACTIVE") {
    if (Date.now() > deadline) {
      throw new Error(
        `File API processing timed out after ${FILE_ACTIVATION_TIMEOUT_MS / 1000}s (still ${state})`
      );
    }
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
    const pollRes = await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    );
    if (!pollRes.ok) {
      const text = await pollRes.text();
      throw new Error(
        `File API poll failed (${pollRes.status}): ${text.slice(0, 200)}`
      );
    }
    const pollJson = (await pollRes.json()) as {
      state?: string;
      mimeType?: string;
    };
    state = pollJson.state ?? state;
    if (pollJson.mimeType) mimeOut = pollJson.mimeType;
    if (state === "FAILED") {
      throw new Error("File API reported FAILED state for uploaded video");
    }
  }

  return {
    uri: initialFile.uri,
    mimeType: mimeOut,
    name: fileName,
  };
}

async function deleteFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { method: "DELETE" }
    );
  } catch {
    // Non-fatal — files auto-delete after 48h anyway.
  }
}

const USER_PROMPT =
  "Analyze this ad video. Return the structured deconstruction as described in the schema. Be accurate — do not invent transcript content.";

export async function deconstructAdVideo(
  videoUrl: string,
  apiKey: string
): Promise<DeconstructResult> {
  const { buffer, mimeType } = await downloadVideo(videoUrl);
  const sizeBytes = buffer.byteLength;
  const useFileApi = sizeBytes > INLINE_THRESHOLD_BYTES;

  let videoPart: Record<string, unknown>;
  let uploadedFileName: string | null = null;

  if (useFileApi) {
    const uploaded = await uploadToFileApi(buffer, mimeType, apiKey);
    uploadedFileName = uploaded.name;
    videoPart = {
      fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri },
    };
  } else {
    videoPart = {
      inlineData: {
        mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4",
        data: arrayBufferToBase64(buffer),
      },
    };
  }

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [videoPart, { text: USER_PROMPT }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message ?? `Gemini API error ${res.status}`;
      throw new Error(msg);
    }

    const textPart = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof textPart !== "string") {
      throw new Error("Gemini returned no analysis text");
    }

    let parsed: AdDeconstruction;
    try {
      parsed = JSON.parse(textPart) as AdDeconstruction;
    } catch {
      throw new Error("Gemini response was not valid JSON");
    }

    const tokensUsed =
      (json?.usageMetadata?.totalTokenCount as number | undefined) ?? null;

    return {
      analysis: parsed,
      model: GEMINI_MODEL,
      tokens_used: tokensUsed,
      size_bytes: sizeBytes,
      mime_type: mimeType,
    };
  } finally {
    // Best-effort cleanup. Files auto-delete after 48h regardless.
    if (uploadedFileName) {
      void deleteFile(uploadedFileName, apiKey);
    }
  }
}
