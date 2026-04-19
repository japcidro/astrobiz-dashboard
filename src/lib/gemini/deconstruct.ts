const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

// Inline video limit is ~20MB for most Gemini models. Keep a buffer.
const MAX_INLINE_VIDEO_BYTES = 18 * 1024 * 1024;
// Abort video download after this many seconds (Vercel max duration is 60s).
const DOWNLOAD_TIMEOUT_MS = 30_000;

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
    if (buffer.byteLength > MAX_INLINE_VIDEO_BYTES) {
      throw new Error(
        `Video too large for inline analysis (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, max 18MB). Skipping.`
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

export async function deconstructAdVideo(
  videoUrl: string,
  apiKey: string
): Promise<DeconstructResult> {
  const { buffer, mimeType } = await downloadVideo(videoUrl);
  const base64 = arrayBufferToBase64(buffer);

  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4",
              data: base64,
            },
          },
          {
            text: "Analyze this ad video. Return the structured deconstruction as described in the schema. Be accurate — do not invent transcript content.",
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

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
    const msg =
      json?.error?.message ?? `Gemini API error ${res.status}`;
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
    size_bytes: buffer.byteLength,
    mime_type: mimeType,
  };
}
