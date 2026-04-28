// Single source of truth for the Winning DNA vocabulary.
//
// This module is imported by:
//   - the Gemini Creative Deconstructor (lib/gemini/deconstruct.ts)
//   - the Claude Angle / Script / Format generators (lib/ai/tools/generators.ts)
//   - the variation-gate validator (lib/ai/validators/variation-gate.ts)
//   - the Approved Library UI (badges + filters)
//
// If any framework is added/renamed/removed here, every consumer above is
// affected at compile time. Keep enums stable — Approved Scripts and
// Deconstructions persist these strings to the database.

// ─── Awareness ladder (Eugene Schwartz) ───

export const AWARENESS_LEVELS = ["L1", "L2", "L3", "L4", "L5"] as const;
export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

export const AWARENESS_LEVEL_LABELS: Record<AwarenessLevel, string> = {
  L1: "Unaware",
  L2: "Problem Aware",
  L3: "Solution Aware",
  L4: "Product Aware",
  L5: "Most Aware",
};

// ─── Funnel stage ───

export const FUNNEL_STAGES = ["TOFU", "MOFU", "BOFU"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// L1-L2 → TOFU, L3 → TOFU/MOFU, L4 → MOFU, L5 → BOFU.
// Cross-check helper exposed for the validator.
export function awarenessToFunnelStages(
  level: AwarenessLevel
): readonly FunnelStage[] {
  switch (level) {
    case "L1":
    case "L2":
      return ["TOFU"];
    case "L3":
      return ["TOFU", "MOFU"];
    case "L4":
      return ["MOFU"];
    case "L5":
      return ["BOFU"];
  }
}

// ─── 12 Hook Frameworks ───

export interface HookFramework {
  id: number;
  name: string;
  description: string;
  example: string;
}

export const HOOK_FRAMEWORKS: readonly HookFramework[] = [
  { id: 1, name: "Juxtaposition", description: "Pair contradictions.", example: "I quit the gym and lost 20 lbs." },
  { id: 2, name: "Ethical Fear", description: "Low-grade threat.", example: "Watch out for these ingredients." },
  { id: 3, name: "Direct Callout", description: "Audience self-selection.", example: "If you're a 35-year-old man losing your hair..." },
  { id: 4, name: "Bold Contrarian", description: "Attack a held belief.", example: "Multivitamins are a scam." },
  { id: 5, name: "Confession", description: "Vulnerable admission.", example: "I haven't washed my hair in 3 weeks." },
  { id: 6, name: "Specificity", description: "Numbers.", example: "I lost 23 lbs in 11 weeks." },
  { id: 7, name: "Question", description: "Reflexive engagement.", example: "Why are 80% of men losing hair before 40?" },
  { id: 8, name: "Story Drop", description: "In-medias-res.", example: "She walked out and never came back." },
  { id: 9, name: "Authority", description: "Borrowed credibility.", example: "As a dermatologist of 14 years..." },
  { id: 10, name: "Insider Secret", description: "Exclusive knowledge.", example: "What dermatologists don't want you to know." },
  { id: 11, name: "Negation", description: "Reverse-psychology don't.", example: "Don't buy another shampoo until..." },
  { id: 12, name: "Demonstration", description: "Visual proof.", example: "Watch this stain disappear in 4 seconds." },
] as const;

// Hook anatomy — every functional hook contains all 3.
export const HOOK_ANATOMY_COMPONENTS = [
  "attention_trigger",
  "information_gap",
  "implied_promise",
] as const;
export type HookAnatomyComponent = (typeof HOOK_ANATOMY_COMPONENTS)[number];

// ─── 7 Strategic Formats ───

export const STRATEGIC_FORMATS = [
  "PAS",
  "Testimonial",
  "Before/After",
  "HSO",
  "Comparison",
  "Demo",
  "Pattern Interrupt",
] as const;
export type StrategicFormat = (typeof STRATEGIC_FORMATS)[number];

// ─── 33-Format Video Library (production-level classification) ───

export interface VideoFormat {
  id: number;
  name: string;
}

export const VIDEO_FORMATS: readonly VideoFormat[] = [
  { id: 1, name: "Green Screen" },
  { id: 2, name: "Talking Head + Text Hook" },
  { id: 3, name: "3D/2D Cartoon" },
  { id: 4, name: "Split Screen" },
  { id: 5, name: "Interview Style" },
  { id: 6, name: "Podcast Style" },
  { id: 7, name: "Moving/Busy" },
  { id: 8, name: "Professional Talking Head" },
  { id: 9, name: "Life With/Without" },
  { id: 10, name: "Product Comparison" },
  { id: 11, name: "Cinematic (No TH/VO)" },
  { id: 12, name: "Street Interview Compilation" },
  { id: 13, name: "Green Screen Reacting" },
  { id: 14, name: "ASMR + Text Overlays" },
  { id: 15, name: "7 Day Test" },
  { id: 16, name: "Debunking Myth" },
  { id: 17, name: "Confession Style" },
  { id: 18, name: "Others' POV" },
  { id: 19, name: "Text Message Screenshot" },
  { id: 20, name: "Product Demo" },
  { id: 21, name: "VO + B-roll" },
  { id: 22, name: "2D Motion Graphics" },
  { id: 23, name: "Fake TikTok Reply" },
  { id: 24, name: "Scientific Explanation" },
  { id: 25, name: "Montage/Memories" },
  { id: 26, name: "Hook Image + B-roll + VO" },
  { id: 27, name: "TH Hook + B-roll Body" },
  { id: 28, name: "UGC Compilation" },
  { id: 29, name: "Problem + Solution" },
  { id: 30, name: "UGC Compilation as Hook" },
  { id: 31, name: "UGC Compilation as Story" },
  { id: 32, name: "Single Street Interview" },
  { id: 33, name: "From This to This" },
] as const;

// ─── UVP layer ───

export const UVP_COMPONENTS = [
  "core_promise",
  "mechanism",
  "differentiator",
  "proof_element",
  "cost_effort_frame",
] as const;
export type UvpComponent = (typeof UVP_COMPONENTS)[number];

// ─── Variation rule — the 4 axes that count as a real variation ───
//
// Per the deconstructor v2.0 spec: "every candidate must shift at least ONE
// of the 4 variables — Who (avatar), Level (awareness), Stage (funnel), or
// Format (creative structure). Swapping the actor on camera is NOT variation."

export const VARIATION_VARIABLES = [
  "Who",
  "Level",
  "Stage",
  "Format",
] as const;
export type VariationVariable = (typeof VARIATION_VARIABLES)[number];

// ─── Helpers ───

const HOOK_TOKEN_REGEX = /#?\s*(\d{1,2})/g;

export interface ParsedHookFramework {
  ids: number[];
  isStack: boolean;
  isCandidate: boolean; // "CANDIDATE NEW: ..." prefix
  raw: string;
}

// Parses a hook_framework string from either side (deconstructor or generator).
// Accepts: "#5 Confession", "#5 Confession + #6 Specificity", "5+6", "5,6",
// "CANDIDATE NEW: lone-comment hook", or any free-form string. Returns the
// numeric IDs found (0-, 1-, or 2-prefix tolerated) so the variation gate
// can compare hook frameworks across angles in a batch even when phrasing
// varies.
export function parseHookFramework(s: string): ParsedHookFramework {
  const raw = (s ?? "").trim();
  const isCandidate = /^\s*CANDIDATE\s+NEW\s*:/i.test(raw);
  const ids: number[] = [];
  let match: RegExpExecArray | null;
  HOOK_TOKEN_REGEX.lastIndex = 0;
  while ((match = HOOK_TOKEN_REGEX.exec(raw)) !== null) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= HOOK_FRAMEWORKS.length && !ids.includes(n)) {
      ids.push(n);
    }
  }
  return { ids, isStack: ids.length > 1, isCandidate, raw };
}

// Build the human-readable list lines used inside the generator + deconstructor
// system prompts. Stays in code, not in DB rows, so adding a 13th hook
// framework here automatically propagates to every prompt at runtime.

export function renderHookFrameworksForPrompt(): string {
  return HOOK_FRAMEWORKS.map(
    (h) => `   ${h.id} ${h.name} — ${h.description} ("${h.example}")`
  ).join("\n");
}

export function renderVideoFormatsForPrompt(): string {
  return VIDEO_FORMATS.map((v) => `${v.id} ${v.name}`).join(" · ");
}

export function renderStrategicFormatsForPrompt(): string {
  return STRATEGIC_FORMATS.join(" / ");
}

export function renderAwarenessLadderForPrompt(): string {
  return [
    "L1 Unaware → TOFU; pattern interrupt, no product mention.",
    "L2 Problem Aware → TOFU; name the pain, hint at solution.",
    "L3 Solution Aware → TOFU/MOFU; position vs. category.",
    "L4 Product Aware → MOFU; lead with proof.",
    "L5 Most Aware → BOFU; offer + urgency + risk reduction.",
  ].join("\n   ");
}

// Frame-cue rules used during deconstruction. Lifted here so the generator
// can be told the same heuristics when invented an angle that proposes a
// specific video_format.
export const FRAME_CUE_RULES: readonly string[] = [
  "High cut frequency (every 1-3s) → 22, 28, 29, or fast UGC compilation.",
  "Single cut at ~5s → 27 (TH hook + B-roll body).",
  "Persistent text overlay throughout → 14 or 22.",
  "Two distinct subjects same frame → 6 (Podcast) or 10 (Comparison).",
  "Same subject, multiple outfits/locations → 15 (7 Day Test) or 20.",
  "Picture-in-picture or stacked frames → 13 (Reacting) or 4 (Split Screen).",
] as const;

export function renderFrameCueRulesForPrompt(): string {
  return FRAME_CUE_RULES.map((r) => `   • ${r}`).join("\n");
}
