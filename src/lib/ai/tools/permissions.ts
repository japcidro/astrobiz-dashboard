// Central role allowlist for AI agent tools. This is the single source
// of truth for "which role can see which tool". Every new tool defaults
// to admin-only; add to MARKETING_TOOLS explicitly to expose it to the
// marketing role.
//
// v1 scope is marketing-only — no Shopify, no profit, no fulfillment.
// Marketing role MUST NOT see net profit ever (P&L is CEO-only per
// the Net Profit tab spec), so never add profit tools to MARKETING_TOOLS.

export type AgentRole = "admin" | "marketing";

export const MARKETING_TOOLS = new Set<string>([
  "get_ad_performance",
  "list_deconstructions",
  "get_ad_deconstruction",
  "list_comparative_reports",
  "get_comparative_report",
  "list_scaling_campaigns",
  "get_autopilot_activity",
]);

// Admin sees everything marketing sees, plus admin-only tools we add later.
// For v1 they're identical.
export const ADMIN_TOOLS = new Set<string>([...MARKETING_TOOLS]);

export function allowedToolsFor(role: AgentRole): Set<string> {
  if (role === "admin") return ADMIN_TOOLS;
  if (role === "marketing") return MARKETING_TOOLS;
  return new Set();
}

export function isToolAllowed(role: AgentRole, toolName: string): boolean {
  return allowedToolsFor(role).has(toolName);
}

// ── Cost guardrails ────────────────────────────────────────────────
// Claude Opus 4.7 list pricing per Anthropic:
//   $15 / MTok input, $75 / MTok output, $1.50 / MTok cache read
// Refuse new tool calls once a single session exceeds this cap.
export const SESSION_COST_CAP_USD = 0.5;

// Hard ceiling on tool-use iterations per user message. If the model
// keeps calling tools without producing text, bail out gracefully.
export const MAX_TOOL_ITERATIONS = 6;

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number
): number {
  return (
    (inputTokens / 1_000_000) * 15 +
    (outputTokens / 1_000_000) * 75 +
    (cacheReadTokens / 1_000_000) * 1.5
  );
}
