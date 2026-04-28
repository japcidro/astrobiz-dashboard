// Server-side variation gate for the Angle Generator and Script Creator.
//
// Enforces the same "shift at least one of {Who, Level, Stage, Format}"
// rule that the Creative Deconstructor uses for Format Compatibility and
// Angle Variations. Catches the failure mode where a generator emits N
// outputs that are surface-level rewrites of the same psychological angle.
//
// Design — gate is ONLY enforced when batch_size >= MIN_BATCH_FOR_GATE.
// For 1-3 outputs we trust the user's request was targeted (e.g. "give me
// 3 BOFU angles for L4 customers" is intentionally same-axis). The
// generate route may choose to retry once on failure with the validator's
// `feedback` string injected as a follow-up user message.

import { parseHookFramework } from "@/lib/ai/v2-frameworks";
import type {
  EmittedAngle,
  EmittedScript,
} from "@/lib/ai/tools/generators";

export const MIN_BATCH_FOR_GATE = 4;

export interface VariationGateResult {
  ok: boolean;
  enforced: boolean;             // false when batch_size < MIN_BATCH_FOR_GATE
  reasons: string[];             // human-readable rule violations
  feedback: string | null;       // injectable text for the retry user message
  duplicate_indices: number[][]; // pairs of indices that violate the duplicate rule
}

interface NormalizedItem {
  index: number;
  who: string;       // avatar (lowercased + trimmed)
  level: string;     // awareness_level
  stage: string;     // funnel_stage
  format: string;    // strategic_format + first video_format token (so script-vs-angle treatment is symmetric)
  hookIds: number[]; // parsed hook framework ids (sorted)
  declaredShifts: Set<string>;
}

function normalize(item: EmittedAngle | EmittedScript, idx: number): NormalizedItem {
  const videoFormat =
    "video_format" in item
      ? item.video_format
      : item.video_format_candidates?.[0] ?? "";
  return {
    index: idx,
    who: (item.avatar ?? "").trim().toLowerCase(),
    level: item.awareness_level,
    stage: item.funnel_stage,
    format: `${item.strategic_format ?? ""}|${videoFormat}`.toLowerCase(),
    hookIds: parseHookFramework(item.hook_framework ?? "").ids.sort(),
    declaredShifts: new Set(item.variable_shift_vs_batch ?? []),
  };
}

export function validateAngleBatch(
  angles: EmittedAngle[]
): VariationGateResult {
  return validateBatch(angles.map(normalize));
}

export function validateScriptBatch(
  scripts: EmittedScript[]
): VariationGateResult {
  return validateBatch(scripts.map(normalize));
}

function validateBatch(items: NormalizedItem[]): VariationGateResult {
  const reasons: string[] = [];
  const duplicate_indices: number[][] = [];

  if (items.length < MIN_BATCH_FOR_GATE) {
    return {
      ok: true,
      enforced: false,
      reasons: [],
      feedback: null,
      duplicate_indices: [],
    };
  }

  // Rule 1: every item must declare at least one shift.
  for (const it of items) {
    if (it.declaredShifts.size === 0) {
      reasons.push(
        `Item #${it.index + 1} has no variable_shift_vs_batch declared.`
      );
    }
  }

  // Rule 2: no two items may share ALL of {who, level, stage, format}.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (
        a.who === b.who &&
        a.level === b.level &&
        a.stage === b.stage &&
        a.format === b.format
      ) {
        duplicate_indices.push([a.index, b.index]);
        reasons.push(
          `Items #${a.index + 1} and #${b.index + 1} share all 4 variables (Who/Level/Stage/Format) — that is a duplicate, not a variation.`
        );
      }
    }
  }

  // Rule 3: across the batch, count distinct (level, stage, format)
  // tuples. If batch >= 4 and distinct tuples < 3, flag low diversity.
  const tuples = new Set(items.map((i) => `${i.level}|${i.stage}|${i.format}`));
  if (items.length >= MIN_BATCH_FOR_GATE && tuples.size < 3) {
    reasons.push(
      `Only ${tuples.size} distinct (Level, Stage, Format) tuple(s) across ${items.length} items — at least 3 are required for a batch this size.`
    );
  }

  // Rule 4 (soft): if all items share the same hook_framework ids, warn.
  // This is appended to reasons but does NOT fail the gate on its own —
  // rule 2 or 3 will fail first if the batch is genuinely flat.
  if (items.length >= MIN_BATCH_FOR_GATE) {
    const hookKey = (h: number[]) => h.join(",");
    const uniqueHooks = new Set(items.map((i) => hookKey(i.hookIds)));
    if (uniqueHooks.size === 1 && items[0].hookIds.length > 0) {
      reasons.push(
        `All items use the same hook_framework (${items[0].hookIds.map((n) => `#${n}`).join("+")}) — consider varying.`
      );
    }
  }

  // Rules 1, 2, and 3 are hard fails. Rule 4 is soft (warning only).
  // We treat the gate as failing if any of rules 1-3 fired.
  const hardFailed =
    items.some((it) => it.declaredShifts.size === 0) ||
    duplicate_indices.length > 0 ||
    tuples.size < 3;

  return {
    ok: !hardFailed,
    enforced: true,
    reasons,
    feedback: hardFailed ? buildFeedback(reasons) : null,
    duplicate_indices,
  };
}

function buildFeedback(reasons: string[]): string {
  return [
    "Your previous batch failed the variation gate. Specifically:",
    ...reasons.map((r) => `  • ${r}`),
    "",
    "Regenerate the batch. Every item must shift at least ONE of {Who, Level, Stage, Format} relative to the others. Swapping the actor on camera is NOT variation. If you cannot honestly produce N distinct items, return fewer.",
  ].join("\n");
}
