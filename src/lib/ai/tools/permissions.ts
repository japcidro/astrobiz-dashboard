// Central role allowlist for AI agent tools. This is the single source
// of truth for "which role can see which tool". Every new tool defaults
// to admin-only; add to MARKETING_TOOLS explicitly to expose it to the
// marketing role.
//
// Hard rule: marketing role MUST NEVER see net profit, COGS, or P&L.
// Profit tools stay in ADMIN_ONLY_TOOLS forever — that's a business
// rule from project_net_profit_tab.md.

export type AgentRole = "admin" | "marketing";

// Tools marketing can use. Admin always inherits this set.
export const MARKETING_TOOLS = new Set<string>([
  // Phase 1 — marketing basics
  "get_ad_performance",
  "list_deconstructions",
  "get_ad_deconstruction",
  "list_comparative_reports",
  "get_comparative_report",
  "list_scaling_campaigns",
  "get_autopilot_activity",
  // Phase 2 — marketing depth
  "list_ad_accounts",
  "get_winners",
  "get_ad_timeline",
  "search_store_knowledge",
  "compare_ads_quick",
  // Phase 2.5 — compilation specialists
  "get_deconstructions_batch",
  "compile_winners",
  // Phase 2 — Shopify (read-only, shared with marketing so they
  // can cross-reference ad performance with real order flow)
  "search_orders",
  "get_order",
  "list_products",
  // Phase 2 — Ops (marketing sees a filtered view; see ops.ts for
  // type-based narrowing)
  "get_stock_alerts",
  "get_recent_notifications",
]);

// Admin-only tools. These are NEVER added to MARKETING_TOOLS, even
// implicitly — we spell out the full admin set below.
export const ADMIN_ONLY_TOOLS = new Set<string>([
  // Fulfillment — operational throughput + quality audits
  "get_jt_delivery_stats",
  "get_pickpack_stats",
  "get_waybill_mismatches",
  // Profit — CEO-only per net profit tab spec
  "get_net_profit",
  // Phase 2.5 — first ACTION tool (side-effect: runs Gemini + upserts
  // a row). Admin-only until we've validated real-world usage patterns.
  "request_deconstruction",
]);

export const ADMIN_TOOLS = new Set<string>([
  ...MARKETING_TOOLS,
  ...ADMIN_ONLY_TOOLS,
]);

export function allowedToolsFor(role: AgentRole): Set<string> {
  if (role === "admin") return ADMIN_TOOLS;
  if (role === "marketing") return MARKETING_TOOLS;
  return new Set();
}

export function isToolAllowed(role: AgentRole, toolName: string): boolean {
  return allowedToolsFor(role).has(toolName);
}

// ── Cost guardrails ────────────────────────────────────────────────
// Claude Sonnet 4.6 list pricing (chat agent uses Sonnet):
//   $3 / MTok input, $15 / MTok output, $0.30 / MTok cache read
// Soft warn at $1.50, hard refuse at $2.00 — gives headroom for deep
// compilation tasks without letting runaway loops get expensive.
export const SESSION_COST_CAP_USD = 2.0;
export const SESSION_COST_SOFT_WARN_USD = 1.5;

// Hard ceiling on tool-use iterations per user message. If the model
// keeps calling tools without producing text, bail out gracefully.
export const MAX_TOOL_ITERATIONS = 6;

// Max request_deconstruction calls per session (each call kicks off a
// real Gemini video analysis — costs ~$0.10 + 30-90s of wall time).
// Counted against the current session_id via ai_tool_calls audit table.
export const MAX_DECONSTRUCTIONS_PER_SESSION = 10;

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number
): number {
  return (
    (inputTokens / 1_000_000) * 3 +
    (outputTokens / 1_000_000) * 15 +
    (cacheReadTokens / 1_000_000) * 0.3
  );
}
