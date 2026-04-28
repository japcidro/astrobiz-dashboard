// Tool-use schemas for the Angle Generator, Script Creator, and Format
// Expansion. Replaces free-form prose output with schema-validated JSON
// so the UI can render typed cards, the variation gate can validate
// diversity, and approved scripts can persist v2.0 classification fields
// without regex parsing.
//
// Every tool name is namespaced with `emit_` so the model can't accidentally
// invoke a different code path. tool_choice forces the named tool, removing
// the chance the model returns prose by mistake.

import {
  AWARENESS_LEVELS,
  FUNNEL_STAGES,
  STRATEGIC_FORMATS,
  VARIATION_VARIABLES,
} from "@/lib/ai/v2-frameworks";

// ─── Shared sub-schemas ───

const CLASSIFICATION_PROPS = {
  awareness_level: {
    type: "string" as const,
    enum: [...AWARENESS_LEVELS],
    description: "Eugene Schwartz awareness level. L1 Unaware → L5 Most Aware.",
  },
  funnel_stage: {
    type: "string" as const,
    enum: [...FUNNEL_STAGES],
    description: "TOFU / MOFU / BOFU. Must be consistent with awareness_level.",
  },
  hook_framework: {
    type: "string" as const,
    description:
      "One of the 12 hook frameworks. Format: '#N Name' (e.g. '#5 Confession'). Stack up to 3: '#5 Confession + #6 Specificity'. If novel, prefix 'CANDIDATE NEW: '.",
  },
  strategic_format: {
    type: "string" as const,
    enum: [...STRATEGIC_FORMATS],
    description: "One of the 7 strategic formats.",
  },
  video_format: {
    type: "string" as const,
    description:
      "One of the 33 video formats. Format: '#N Name' (e.g. '#27 TH Hook + B-roll Body'). For angles, use video_format_candidates instead — this single-format slot is for scripts.",
  },
};

const VARIABLE_SHIFT_SCHEMA = {
  type: "array" as const,
  items: {
    type: "string" as const,
    enum: [...VARIATION_VARIABLES],
  },
  minItems: 1,
  description:
    "Which of {Who, Level, Stage, Format} this output shifts compared to others in the same batch (and to validated winners, if any). Swapping the actor on camera does NOT count.",
};

// ─── emit_angles ───

export const EMIT_ANGLES_TOOL = {
  name: "emit_angles",
  description:
    "Emit the final batch of ad angles. Call this exactly once with all angles. Do not output prose answers — every angle must be inside this tool call.",
  input_schema: {
    type: "object" as const,
    required: ["batch_intent", "angles"],
    properties: {
      batch_intent: {
        type: "string" as const,
        description:
          "One sentence: what variation strategy ties this batch together. E.g. 'Three angles testing the same viral mechanism across L2/L3/L4 awareness.'",
      },
      angles: {
        type: "array" as const,
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object" as const,
          required: [
            "title",
            "big_idea",
            "avatar",
            "awareness_level",
            "funnel_stage",
            "hook_framework",
            "strategic_format",
            "video_format_candidates",
            "copy_hook",
            "variable_shift_vs_batch",
            "reasoning",
          ],
          properties: {
            title: {
              type: "string" as const,
              description: "Short descriptive title for this angle.",
            },
            big_idea: {
              type: "string" as const,
              description:
                "One sentence: the entry-point belief or claim this angle uses to enter the conversation in the viewer's head.",
            },
            avatar: {
              type: "string" as const,
              description:
                "Who this angle is talking to (demographic + psychographic). The avatar is who the viewer sees themselves in, not necessarily who is on camera.",
            },
            awareness_level: CLASSIFICATION_PROPS.awareness_level,
            funnel_stage: CLASSIFICATION_PROPS.funnel_stage,
            hook_framework: CLASSIFICATION_PROPS.hook_framework,
            strategic_format: CLASSIFICATION_PROPS.strategic_format,
            video_format_candidates: {
              type: "array" as const,
              minItems: 1,
              maxItems: 3,
              items: { type: "string" as const },
              description:
                "1-3 candidate video formats from the 33-format library. Format: '#N Name'.",
            },
            copy_hook: {
              type: "string" as const,
              description:
                "The actual 0-3s hook line as it would be spoken or shown on screen. Taglish ok.",
            },
            variable_shift_vs_batch: VARIABLE_SHIFT_SCHEMA,
            reasoning: {
              type: "string" as const,
              description:
                "1-2 sentences: why this angle works. Anchor in avatar truth, market sophistication, or a specific winner's viral_mechanism.",
            },
            inspired_by_winner: {
              type: "string" as const,
              description:
                "Optional. If this angle preserves a specific validated winner's viral_mechanism, name the winner here.",
            },
          },
        },
      },
    },
  },
} as const;

// ─── emit_scripts ───

export const EMIT_SCRIPTS_TOOL = {
  name: "emit_scripts",
  description:
    "Emit the final batch of video ad scripts. Call this exactly once with all scripts. Do not output prose answers — every script must be inside this tool call.",
  input_schema: {
    type: "object" as const,
    required: ["batch_intent", "scripts"],
    properties: {
      batch_intent: {
        type: "string" as const,
        description:
          "One sentence: what variation strategy ties this batch together.",
      },
      scripts: {
        type: "array" as const,
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object" as const,
          required: [
            "script_number",
            "angle_title",
            "avatar",
            "angle_type",
            "intensity",
            "capacity",
            "awareness_level",
            "funnel_stage",
            "hook_framework",
            "strategic_format",
            "video_format",
            "hook",
            "body_script",
            "variant_hooks",
            "variable_shift_vs_batch",
          ],
          properties: {
            script_number: {
              type: "integer" as const,
              minimum: 1,
              description:
                "Sequential number within this batch (1, 2, 3, ...).",
            },
            angle_title: { type: "string" as const },
            avatar: { type: "string" as const },
            angle_type: {
              type: "string" as const,
              enum: ["D", "E", "M", "B"],
              description:
                "D Desire-led / E Experience-led / M Emotion-led / B Behavior-led.",
            },
            intensity: {
              type: "integer" as const,
              minimum: 1,
              maximum: 10,
              description:
                "Emotional pressure of the angle (1 mild, 10 visceral).",
            },
            capacity: {
              type: "integer" as const,
              minimum: 1,
              maximum: 10,
              description:
                "How much the avatar can handle from this angle without bouncing (1 fragile, 10 robust).",
            },
            awareness_level: CLASSIFICATION_PROPS.awareness_level,
            funnel_stage: CLASSIFICATION_PROPS.funnel_stage,
            hook_framework: CLASSIFICATION_PROPS.hook_framework,
            strategic_format: CLASSIFICATION_PROPS.strategic_format,
            video_format: CLASSIFICATION_PROPS.video_format,
            hook: {
              type: "string" as const,
              description: "The 0-3s hook line — exactly as spoken or shown.",
            },
            body_script: {
              type: "string" as const,
              description:
                "The body voiceover. Multiple paragraphs ok. Plain spoken Taglish (or whatever language the brand docs target).",
            },
            variant_hooks: {
              type: "array" as const,
              minItems: 0,
              maxItems: 5,
              items: { type: "string" as const },
              description:
                "Alternative hook lines for testing (different framework or specificity vs the primary hook).",
            },
            variable_shift_vs_batch: VARIABLE_SHIFT_SCHEMA,
            inspired_by_winner: {
              type: "string" as const,
              description:
                "Optional. If this script preserves a specific validated winner's viral_mechanism, name the winner here.",
            },
          },
        },
      },
    },
  },
} as const;

// ─── emit_formats ───

export const EMIT_FORMATS_TOOL = {
  name: "emit_formats",
  description:
    "Emit format-expansion candidates for a winning angle/script. Call this exactly once.",
  input_schema: {
    type: "object" as const,
    required: ["source_summary", "expansions"],
    properties: {
      source_summary: {
        type: "string" as const,
        description:
          "One sentence: what winner or angle is being expanded, and what viral_mechanism is being preserved.",
      },
      expansions: {
        type: "array" as const,
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object" as const,
          required: [
            "target_video_format",
            "fit_reason",
            "script_shift",
            "variable_shift_vs_batch",
            "risk",
          ],
          properties: {
            target_video_format: {
              type: "string" as const,
              description: "#N Name from the 33-format library.",
            },
            fit_reason: {
              type: "string" as const,
              description:
                "One sentence: why this format carries the same DNA as the source.",
            },
            script_shift: {
              type: "string" as const,
              description:
                "What concretely changes in the script when ported (hook delivery, scene structure, CTA placement).",
            },
            variable_shift_vs_batch: VARIABLE_SHIFT_SCHEMA,
            risk: {
              type: "string" as const,
              description:
                "One sentence: where this expansion might miss vs the original.",
            },
          },
        },
      },
    },
  },
} as const;

// ─── Tool registry by tool_type ───

export const TOOL_BY_TYPE: Record<
  "angles" | "scripts" | "formats",
  | typeof EMIT_ANGLES_TOOL
  | typeof EMIT_SCRIPTS_TOOL
  | typeof EMIT_FORMATS_TOOL
> = {
  angles: EMIT_ANGLES_TOOL,
  scripts: EMIT_SCRIPTS_TOOL,
  formats: EMIT_FORMATS_TOOL,
};

// ─── Output types (mirror the schemas above) ───

import type {
  AwarenessLevel,
  FunnelStage,
  VariationVariable,
} from "@/lib/ai/v2-frameworks";

export interface EmittedAngle {
  title: string;
  big_idea: string;
  avatar: string;
  awareness_level: AwarenessLevel;
  funnel_stage: FunnelStage;
  hook_framework: string;
  strategic_format: string;
  video_format_candidates: string[];
  copy_hook: string;
  variable_shift_vs_batch: VariationVariable[];
  reasoning: string;
  inspired_by_winner?: string;
}

export interface EmittedAnglesBatch {
  batch_intent: string;
  angles: EmittedAngle[];
}

export interface EmittedScript {
  script_number: number;
  angle_title: string;
  avatar: string;
  angle_type: "D" | "E" | "M" | "B";
  intensity: number;
  capacity: number;
  awareness_level: AwarenessLevel;
  funnel_stage: FunnelStage;
  hook_framework: string;
  strategic_format: string;
  video_format: string;
  hook: string;
  body_script: string;
  variant_hooks: string[];
  variable_shift_vs_batch: VariationVariable[];
  inspired_by_winner?: string;
}

export interface EmittedScriptsBatch {
  batch_intent: string;
  scripts: EmittedScript[];
}

export interface EmittedFormatExpansion {
  target_video_format: string;
  fit_reason: string;
  script_shift: string;
  variable_shift_vs_batch: VariationVariable[];
  risk: string;
}

export interface EmittedFormatsBatch {
  source_summary: string;
  expansions: EmittedFormatExpansion[];
}

export type EmittedBatch =
  | EmittedAnglesBatch
  | EmittedScriptsBatch
  | EmittedFormatsBatch;
