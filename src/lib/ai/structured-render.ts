// Render structured tool_use output to the markdown shapes the existing
// UI consumes (assistant-message-renderer.tsx + script-parser.ts). This
// keeps the chat surface and "Copy All" / approval flows working while
// the structured JSON is the source-of-truth in ai_generations.structured_output.

import type {
  EmittedAnglesBatch,
  EmittedFormatsBatch,
  EmittedScriptsBatch,
} from "@/lib/ai/tools/generators";

export function renderAnglesMarkdown(batch: EmittedAnglesBatch): string {
  const intent = batch.batch_intent
    ? `_Batch intent — ${batch.batch_intent}_\n\n`
    : "";

  const blocks = batch.angles.map((a, i) => {
    const idx = i + 1;
    const winner = a.inspired_by_winner
      ? `\n*Inspired by winner: ${a.inspired_by_winner}*`
      : "";
    return [
      `## ANGLE ${idx} — ${a.title}`,
      `**Avatar:** ${a.avatar} | **Awareness:** ${a.awareness_level} | **Stage:** ${a.funnel_stage}`,
      `**Hook:** ${a.hook_framework} | **Strategic:** ${a.strategic_format} | **Video Candidates:** ${a.video_format_candidates.join(", ")}`,
      `**Variable Shift:** ${a.variable_shift_vs_batch.join(", ")}`,
      "",
      `**Big Idea:** ${a.big_idea}`,
      "",
      `**Copy Hook:**\n${a.copy_hook}`,
      "",
      `**Reasoning:** ${a.reasoning}${winner}`,
      "",
      "---",
    ].join("\n");
  });

  return intent + blocks.join("\n\n");
}

// Note — the existing script-parser.ts regex looks for `## SCRIPT N` headers
// and `**HOOK:**` / `**BODY SCRIPT:**` / `**VARIANT HOOKS:**` markers. We
// preserve those exactly so old approval flows continue to work without
// any changes to script-parser.ts itself.
export function renderScriptsMarkdown(batch: EmittedScriptsBatch): string {
  const intent = batch.batch_intent
    ? `_Batch intent — ${batch.batch_intent}_\n\n`
    : "";

  const blocks = batch.scripts.map((s) => {
    const winner = s.inspired_by_winner
      ? `\n*Inspired by winner: ${s.inspired_by_winner}*`
      : "";
    const variants =
      s.variant_hooks.length > 0
        ? s.variant_hooks
            .map((h, i) => `${i + 1}. ${h}`)
            .join("\n")
        : "_(none)_";

    return [
      `## SCRIPT ${s.script_number} — ${s.angle_title}`,
      `**Avatar:** ${s.avatar} | **Type:** ${s.angle_type} | **Intensity:** ${s.intensity} | **Capacity:** ${s.capacity}`,
      `**Awareness:** ${s.awareness_level} | **Stage:** ${s.funnel_stage} | **Hook:** ${s.hook_framework} | **Strategic:** ${s.strategic_format} | **Video:** ${s.video_format}`,
      `**Variable Shift:** ${s.variable_shift_vs_batch.join(", ")}${winner}`,
      "",
      `**HOOK:**\n${s.hook}`,
      "",
      `**BODY SCRIPT:**\n${s.body_script}`,
      "",
      `**VARIANT HOOKS:**\n${variants}`,
      "",
      "---",
    ].join("\n");
  });

  return intent + blocks.join("\n\n");
}

export function renderFormatsMarkdown(batch: EmittedFormatsBatch): string {
  const intent = batch.source_summary
    ? `_Source — ${batch.source_summary}_\n\n`
    : "";

  const blocks = batch.expansions.map((e, i) => {
    return [
      `## FORMAT ${i + 1} — ${e.target_video_format}`,
      `**Variable Shift:** ${e.variable_shift_vs_batch.join(", ")}`,
      "",
      `**Fit Reason:** ${e.fit_reason}`,
      "",
      `**Script Shift:** ${e.script_shift}`,
      "",
      `**Risk:** ${e.risk}`,
      "",
      "---",
    ].join("\n");
  });

  return intent + blocks.join("\n\n");
}
