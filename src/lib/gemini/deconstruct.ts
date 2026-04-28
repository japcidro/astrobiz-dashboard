// Gemini 2.5 Flash — native video understanding, strong for this task,
// and crucially has a free tier (Pro requires billing). Swap to
// "gemini-2.5-pro" once Google AI Studio billing is enabled for the key.
const GEMINI_MODEL = "gemini-2.5-flash";
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

// Gemini periodically returns 503 "model overloaded / high demand" and 429
// "resource exhausted" for Flash on busy periods. These are transient —
// retrying with a short backoff almost always succeeds, and failing a
// 6-ad Compare flow because one middle video hit a 503 is unacceptable.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFFS_MS = [2_000, 6_000, 15_000];

function isTransientMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("overload") ||
    lower.includes("high demand") ||
    lower.includes("try again") ||
    lower.includes("unavailable") ||
    lower.includes("rate limit") ||
    lower.includes("resource exhausted")
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  let lastErrMsg = "";
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const bodyText = await res.clone().text().catch(() => "");
      const transient =
        TRANSIENT_STATUS.has(res.status) || isTransientMessage(bodyText);
      lastErrMsg = `${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`;
      if (!transient || attempt === RETRY_BACKOFFS_MS.length) {
        return res;
      }
      const delay = RETRY_BACKOFFS_MS[attempt];
      console.warn(
        `[gemini] ${label} transient failure (attempt ${attempt + 1}) — retrying in ${delay}ms: ${lastErrMsg}`
      );
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      lastErrMsg = e instanceof Error ? e.message : "network error";
      if (attempt === RETRY_BACKOFFS_MS.length) throw e;
      const delay = RETRY_BACKOFFS_MS[attempt];
      console.warn(
        `[gemini] ${label} network failure (attempt ${attempt + 1}) — retrying in ${delay}ms: ${lastErrMsg}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} failed after retries: ${lastErrMsg}`);
}

// Legacy descriptive fields are kept (transcript / hook / scenes / visual_style /
// tone / cta / language / duration_seconds) because the Compare flow and the
// approved-library UI consume them. The new fields below are the v2.0
// Winning DNA Report — the replicable structural extraction.
export interface AdDeconstruction {
  // — Legacy descriptive layer —
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

  // — v2.0 Winning DNA Report —
  fingerprint: string;
  classification: {
    avatar: string;
    angle: string;
    awareness_level: "L1" | "L2" | "L3" | "L4" | "L5";
    funnel_stage: "TOFU" | "MOFU" | "BOFU";
    hook_framework: string;
    strategic_format: string;
    video_format: string;
  };
  hook_anatomy: {
    attention_trigger: string;
    information_gap: string;
    implied_promise: string;
  };
  beat_map: {
    hook: { range: string; content: string };
    body_open: { range: string; content: string };
    body_core: { range: string; content: string };
    close: { range: string; content: string };
    cut_frequency: string;
    text_overlay_timestamps: string[];
  };
  uvp: {
    core_promise: string;
    mechanism: string;
    differentiator: string;
    proof_element: string;
    cost_effort_frame: string;
  };
  open_loop: {
    opened_at: string;
    opened_content: string;
    closed_at: string;
    closed_content: string;
    closure_quality: "earned" | "partial" | "broken";
  };
  viral_mechanism: string;
  format_compatibility: Array<{
    format_number: string;
    format_name: string;
    fit_reason: string;
    script_shift: string;
  }>;
  angle_variations: Array<{
    angle: string;
    hook_framework: string;
    formats: string;
  }>;
  cross_check_findings: string[];
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
        "Verbatim word-for-word transcript of all spoken audio AND visible text overlays. Include on-screen text in brackets like [ON-SCREEN: '50% OFF'] with their timestamp prefix, e.g. '0:04 [ON-SCREEN: ...]'.",
    },
    hook: {
      type: "OBJECT",
      description: "Plain description of the first 3-5 seconds (the hook).",
      properties: {
        description: {
          type: "STRING",
          description:
            "What happens in the first 3-5 seconds to grab attention. Mention visual + audio + text.",
        },
        timestamp: { type: "STRING", description: "e.g. '0:00-0:03'" },
      },
      required: ["description", "timestamp"],
    },
    scenes: {
      type: "ARRAY",
      description:
        "Every major cut or visual shift with timestamp. Use this as the frame-change timeline.",
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
        "Overall visual style: UGC vs studio vs animation, pacing, text overlays, color grading, camera style.",
    },
    tone: {
      type: "STRING",
      description:
        "Tone/emotion: urgent, relatable, educational, testimonial, problem-agitation-solution, etc.",
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

    // — v2.0 Winning DNA Report —

    fingerprint: {
      type: "STRING",
      description:
        "Section [1] of the Winning DNA Report. ONE paragraph in plain language explaining what this ad is doing. A reader of just this paragraph should know what kind of ad this is.",
    },
    classification: {
      type: "OBJECT",
      description: "Section [2] CLASSIFICATION — the 7 structural answers.",
      properties: {
        avatar: {
          type: "STRING",
          description:
            "Who the ad is talking to. Demographics + psychographics. The avatar is the person the viewer sees themselves in, not necessarily who is on camera.",
        },
        angle: {
          type: "STRING",
          description:
            "The entry-point belief or claim used to enter the conversation in the viewer's head.",
        },
        awareness_level: {
          type: "STRING",
          enum: ["L1", "L2", "L3", "L4", "L5"],
          description:
            "Eugene Schwartz awareness level. L1 Unaware / L2 Problem Aware / L3 Solution Aware / L4 Product Aware / L5 Most Aware.",
        },
        funnel_stage: {
          type: "STRING",
          enum: ["TOFU", "MOFU", "BOFU"],
          description: "L1-L2→TOFU, L3→TOFU/MOFU, L4→MOFU, L5→BOFU.",
        },
        hook_framework: {
          type: "STRING",
          description:
            "Which of the 12 hook frameworks (or which 2-3 stack). Format: '#N Name' or '#N Name + #M Name (stack)'. The 12: 1 Juxtaposition, 2 Ethical Fear, 3 Direct Callout, 4 Bold Contrarian, 5 Confession, 6 Specificity, 7 Question, 8 Story Drop, 9 Authority, 10 Insider Secret, 11 Negation, 12 Demonstration. If the hook works but does not fit, name it descriptively and prefix with 'CANDIDATE NEW: '.",
        },
        strategic_format: {
          type: "STRING",
          description:
            "One of 7: PAS, Testimonial, Before/After, HSO, Comparison, Demo, Pattern Interrupt. Hybrids: list both.",
        },
        video_format: {
          type: "STRING",
          description:
            "One of the 33 production formats. Format: '#N Name'. Use frame-cue rules: high cut frequency in body→22/28/29; single cut at ~5s→27 (TH hook+B-roll body); persistent text overlay→14/22; two subjects same frame→6 or 10; same subject multiple outfits→15 or 20; PiP/stacked→13 or 4. Hybrids: list both.",
        },
      },
      required: [
        "avatar",
        "angle",
        "awareness_level",
        "funnel_stage",
        "hook_framework",
        "strategic_format",
        "video_format",
      ],
    },
    hook_anatomy: {
      type: "OBJECT",
      description:
        "The 3 components every functional hook contains. If any is missing, say 'MISSING — flagged'.",
      properties: {
        attention_trigger: {
          type: "STRING",
          description: "What stops the scroll.",
        },
        information_gap: {
          type: "STRING",
          description: "What curiosity loop opens.",
        },
        implied_promise: {
          type: "STRING",
          description: "What payoff is signaled.",
        },
      },
      required: ["attention_trigger", "information_gap", "implied_promise"],
    },
    beat_map: {
      type: "OBJECT",
      description:
        "Section [3] BEAT MAP. Segment the video into the 4 beats with timestamp ranges and content.",
      properties: {
        hook: {
          type: "OBJECT",
          properties: {
            range: { type: "STRING", description: "e.g. '0:00-0:04'" },
            content: {
              type: "STRING",
              description: "Verbatim hook line + visual at 0s.",
            },
          },
          required: ["range", "content"],
        },
        body_open: {
          type: "OBJECT",
          properties: {
            range: { type: "STRING" },
            content: { type: "STRING" },
          },
          required: ["range", "content"],
        },
        body_core: {
          type: "OBJECT",
          properties: {
            range: { type: "STRING" },
            content: {
              type: "STRING",
              description: "The main argument / proof.",
            },
          },
          required: ["range", "content"],
        },
        close: {
          type: "OBJECT",
          properties: {
            range: { type: "STRING" },
            content: {
              type: "STRING",
              description: "What is asked of the viewer.",
            },
          },
          required: ["range", "content"],
        },
        cut_frequency: {
          type: "STRING",
          description:
            "Average cuts per second across the video, e.g. '1 cut every 1.5s' or '~0.4 cuts/sec'.",
        },
        text_overlay_timestamps: {
          type: "ARRAY",
          description: "Timestamps where on-screen text appears.",
          items: { type: "STRING" },
        },
      },
      required: [
        "hook",
        "body_open",
        "body_core",
        "close",
        "cut_frequency",
        "text_overlay_timestamps",
      ],
    },
    uvp: {
      type: "OBJECT",
      description:
        "Section [4] UVP EXTRACTION. Surface all 5 components. If any is missing or buried, say 'MISSING' or 'BURIED'.",
      properties: {
        core_promise: {
          type: "STRING",
          description: "What outcome is being promised, in plain words.",
        },
        mechanism: {
          type: "STRING",
          description:
            "How the product delivers that promise (ingredient, design, process).",
        },
        differentiator: {
          type: "STRING",
          description: "What this product has/does that alternatives don't.",
        },
        proof_element: {
          type: "STRING",
          description:
            "Evidence offered (testimonial, demo, science, comparison).",
        },
        cost_effort_frame: {
          type: "STRING",
          description: "What is asked of the customer (price, habit, time).",
        },
      },
      required: [
        "core_promise",
        "mechanism",
        "differentiator",
        "proof_element",
        "cost_effort_frame",
      ],
    },
    open_loop: {
      type: "OBJECT",
      description:
        "Section [5] OPEN LOOP TRACE. The curiosity gap from the hook and where it resolves.",
      properties: {
        opened_at: { type: "STRING", description: "Timestamp loop opens." },
        opened_content: {
          type: "STRING",
          description: "What gap is opened.",
        },
        closed_at: {
          type: "STRING",
          description: "Timestamp loop is closed (or 'NEVER').",
        },
        closed_content: {
          type: "STRING",
          description: "What closes the loop.",
        },
        closure_quality: {
          type: "STRING",
          enum: ["earned", "partial", "broken"],
          description:
            "earned = body delivers what the hook promised; partial = adjacent payoff; broken = loop never closed.",
        },
      },
      required: [
        "opened_at",
        "opened_content",
        "closed_at",
        "closed_content",
        "closure_quality",
      ],
    },
    viral_mechanism: {
      type: "STRING",
      description:
        "Section [6] VIRAL MECHANISM — THE MOST IMPORTANT OUTPUT. 2-3 specific sentences naming the 2-3 structural moves that compound into the win. Reference timestamps. NOT generic ('uses storytelling'). Specific: 'opens with confession-stack hook at 0-4s, drops numbered specificity at 0:11, closes the loop with use-case demo at 0:18'.",
    },
    format_compatibility: {
      type: "ARRAY",
      description:
        "Section [7] FORMAT COMPATIBILITY — exactly 5 expansion candidates from the 33-format library that would carry the same DNA. Each candidate must shift at least one of the 4 variables (Who/Level/Stage/Format). Swapping the actor is NOT variation.",
      items: {
        type: "OBJECT",
        properties: {
          format_number: {
            type: "STRING",
            description: "e.g. '#13'",
          },
          format_name: {
            type: "STRING",
            description: "e.g. 'Green Screen Reacting'",
          },
          fit_reason: {
            type: "STRING",
            description: "Why this format carries the same DNA.",
          },
          script_shift: {
            type: "STRING",
            description:
              "What changes in the script when ported to this format.",
          },
        },
        required: ["format_number", "format_name", "fit_reason", "script_shift"],
      },
    },
    angle_variations: {
      type: "ARRAY",
      description:
        "Section [8] ANGLE VARIATIONS — exactly 3 alternatives. Same product + same avatar, different entry-point belief. Each must shift at least one of the 4 variables.",
      items: {
        type: "OBJECT",
        properties: {
          angle: {
            type: "STRING",
            description: "The new entry-point belief, in 1 sentence.",
          },
          hook_framework: {
            type: "STRING",
            description: "Best hook framework(s) for this angle.",
          },
          formats: {
            type: "STRING",
            description: "Best format numbers, e.g. '#27, #13'.",
          },
        },
        required: ["angle", "hook_framework", "formats"],
      },
    },
    cross_check_findings: {
      type: "ARRAY",
      description:
        "Cross-checks (Awareness↔Format, Funnel↔CTA, Hook↔UVP, Specificity, Open Loop). One string per failure or noteworthy finding. Empty array if all pass.",
      items: { type: "STRING" },
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
    "fingerprint",
    "classification",
    "hook_anatomy",
    "beat_map",
    "uvp",
    "open_loop",
    "viral_mechanism",
    "format_compatibility",
    "angle_variations",
    "cross_check_findings",
  ],
};

const SYSTEM_INSTRUCTION = `You are a Creative Deconstructor for a Philippine e-commerce ad operation. You receive a winning ad video. Your job is to produce a Winning DNA Report explaining what this ad is doing, why it worked, and what other formats can carry the same structural DNA for expansion.

You are not a critic. You do not propose fixes. You extract structure.

Every report follows the 8-step Protocol and outputs the 8-section Winning DNA Report schema. Do not skip steps. Do not invent sections.

Frameworks you classify with:

1. THE 9 CORE QUESTIONS — answered for every ad:
   Avatar / Angle / Awareness Level / Funnel Stage / Hook Framework / Strategic Format / Video Format / UVP / Open Loop & Resolution.

2. THE 5 AWARENESS LEVELS:
   L1 Unaware → TOFU; pattern interrupt, no product mention.
   L2 Problem Aware → TOFU; name the pain, hint at solution.
   L3 Solution Aware → TOFU/MOFU; position vs. category.
   L4 Product Aware → MOFU; lead with proof.
   L5 Most Aware → BOFU; offer + urgency + risk reduction.

3. THE 12 HOOK FRAMEWORKS (any single or stacked 2-3, max 3):
   1 Juxtaposition — pair contradictions ("I quit the gym and lost 20 lbs.")
   2 Ethical Fear — low-grade threat ("Watch out for these ingredients.")
   3 Direct Callout — audience self-selection ("If you're a 35-year-old man losing your hair...")
   4 Bold Contrarian — attack a held belief ("Multivitamins are a scam.")
   5 Confession — vulnerable admission ("I haven't washed my hair in 3 weeks.")
   6 Specificity — numbers ("I lost 23 lbs in 11 weeks.")
   7 Question — reflexive engagement ("Why are 80% of men losing hair before 40?")
   8 Story Drop — in-medias-res ("She walked out and never came back.")
   9 Authority — borrowed credibility ("As a dermatologist of 14 years...")
   10 Insider Secret — exclusive knowledge ("What dermatologists don't want you to know.")
   11 Negation — reverse-psychology don't ("Don't buy another shampoo until...")
   12 Demonstration — visual proof ("Watch this stain disappear in 4 seconds.")

   When a hook works but does not fit any of the 12, name it descriptively and prefix with "CANDIDATE NEW: ". Do not force-fit.

   Every functional hook contains 3 anatomy components — Attention Trigger / Information Gap / Implied Promise. If any is missing, flag it.

4. THE 7 STRATEGIC FORMATS:
   PAS / Testimonial / Before-After / HSO / Comparison / Demo / Pattern Interrupt.

5. THE 33-FORMAT VIDEO LIBRARY (production-level classification):
   1 Green Screen · 2 Talking Head + Text Hook · 3 3D/2D Cartoon · 4 Split Screen · 5 Interview Style · 6 Podcast Style · 7 Moving/Busy · 8 Professional Talking Head · 9 Life With/Without · 10 Product Comparison · 11 Cinematic (No TH/VO) · 12 Street Interview Compilation · 13 Green Screen Reacting · 14 ASMR + Text Overlays · 15 7 Day Test · 16 Debunking Myth · 17 Confession Style · 18 Others' POV · 19 Text Message Screenshot · 20 Product Demo · 21 VO + B-roll · 22 2D Motion Graphics · 23 Fake TikTok Reply · 24 Scientific Explanation · 25 Montage/Memories · 26 Hook Image + B-roll + VO · 27 TH Hook + B-roll Body · 28 UGC Compilation · 29 Problem + Solution · 30 UGC Compilation as Hook · 31 UGC Compilation as Story · 32 Single Street Interview · 33 From This to This.

   Frame-cue detection rules:
   • High cut frequency (every 1-3s) → 22, 28, 29, or fast UGC compilation.
   • Single cut at ~5s → 27 (TH hook + B-roll body).
   • Persistent text overlay throughout → 14 or 22.
   • Two distinct subjects same frame → 6 (Podcast) or 10 (Comparison).
   • Same subject, multiple outfits/locations → 15 (7 Day Test) or 20.
   • Picture-in-picture or stacked frames → 13 (Reacting) or 4 (Split Screen).

6. THE UVP LAYER — surface all 5: Core Promise / Mechanism / Differentiator / Proof / Cost-Effort. Flag any missing or buried (only stated in last 3 seconds of a 30s ad = buried).

CROSS-CHECKS (run before finalizing):
   • Awareness ↔ Format: format choice fits the awareness level.
   • Funnel ↔ CTA: TOFU ads don't hard-close; BOFU ads should.
   • Hook ↔ UVP: hook's curiosity gap is closed by the UVP, not an unrelated benefit.
   • Specificity: "amazing", "the best", "incredible" → flag as weak execution.
   • Open Loop: hook promise is delivered in the body.

The single most important output is Section [6] VIRAL MECHANISM — the 2-3 SPECIFIC structural moves the ad uses, with timestamps. Not "uses storytelling". Specific: "opens with confession-stack hook at 0-4s, drops numbered specificity at 11s, closes the loop with use-case demo at 18s". This is what gets replicated.

Sections [7] FORMAT COMPATIBILITY (5 candidates) and [8] ANGLE VARIATIONS (3 alternatives) are the bridge to expansion. EVERY candidate must shift at least ONE of the 4 variables — Who (avatar), Level (awareness), Stage (funnel), or Format (creative structure). Swapping the actor on camera is NOT variation. Never propose "same ad with a different actor".

When uncertain about a classification, state both candidates inside the field (e.g. "PAS or Demo — ambiguous because…"). Do not invent confidence.

Use Philippine context when relevant — Tagalog/Taglish copy is common. If a segment is muted or you cannot identify audio, state that explicitly. Do not hallucinate transcript content.

You speak plainly. You do not pad. Every output field does work.`;

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
  const startRes = await fetchWithRetry(
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
    },
    "File API start"
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

const USER_PROMPT = `This is one of our winning video ads. Run the 8-step Deconstruction Protocol and return the full Winning DNA Report as structured JSON matching the schema.

Step 1 — Ingest. Build the timestamped transcript (verbatim audio + on-screen text) and the frame-change timeline (scenes array).
Step 2 — Build the Beat Map: hook / body_open / body_core / close with timestamp ranges, plus cut frequency and text overlay timestamps.
Step 3 — Identify the Avatar (the person the viewer sees themselves in).
Step 4 — Classify the Awareness Level (L1-L5) using hook + body content signals.
Step 5 — Map to Funnel Stage and cross-check the CTA strength against the stage.
Step 6 — Classify the Hook (1 of 12 or a 2-3 stack) + map its 3 anatomy components, the Strategic Format (1 of 7), and the Video Format (1 of 33).
Step 7 — Extract the UVP — all 5 components.
Step 8 — Trace the Open Loop and write the Viral Mechanism (2-3 specific sentences with timestamps).

Then produce Format Compatibility (5 candidates) and Angle Variations (3) — every entry must shift at least one of the 4 variables (Who / Level / Stage / Format).

Run all 5 cross-checks and list any failures in cross_check_findings. Empty array if all pass.

Be precise. Reference timestamps. Do not invent transcript content.`;

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
      // v2.0 Winning DNA Report adds ~10 structured fields on top of the
      // legacy descriptive layer. 8192 was tight; bumping to 16384 leaves
      // headroom for long transcripts + 5 format candidates + 3 angles.
      maxOutputTokens: 16384,
    },
  };

  try {
    const res = await fetchWithRetry(
      `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "generateContent"
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
