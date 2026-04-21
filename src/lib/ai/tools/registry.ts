// Registry: the source of truth for AI agent tool definitions and their
// dispatcher. Keep tool descriptions crisp — the model's ability to pick
// the right tool lives and dies by these descriptions.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAdPerformance,
  listDeconstructions,
  getAdDeconstruction,
  listComparativeReports,
  getComparativeReport,
  listScalingCampaigns,
  getAutopilotActivity,
} from "./marketing";
import { allowedToolsFor, type AgentRole } from "./permissions";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  supabase: SupabaseClient;
  fbToken: string;
}

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<unknown>;

// ── Definitions (Anthropic tools API schema) ─────────────────────────
const ALL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_ad_performance",
    description:
      "Pull live Facebook Ads performance for the date range the user implies. Returns per-ad metrics (spend, purchases, ROAS, CPP/cpa, CTR) plus account totals. Use this for ANY question about current ad performance, winners/losers, spend, ROAS, or CPP. Defaults to last_7d if the user doesn't specify. Sort options: spend (default), purchases, roas, cpa (low→high), ctr.",
    input_schema: {
      type: "object",
      properties: {
        date_preset: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "last_7d",
            "last_14d",
            "last_30d",
            "this_month",
            "last_month",
          ],
          description:
            "Which date range to pull. Infer from the user message (e.g. 'this week' → last_7d, 'yesterday' → yesterday).",
        },
        account_filter: {
          type: "string",
          description:
            "Facebook ad account ID (format 'act_123…') to filter to, or 'ALL' for every connected account. Default ALL.",
        },
        min_spend: {
          type: "number",
          description: "Only return ads with spend >= this (₱).",
        },
        min_purchases: {
          type: "number",
          description: "Only return ads with purchases >= this.",
        },
        status: {
          type: "string",
          description:
            "Filter to FB delivery status, e.g. 'ACTIVE' or 'PAUSED'. Case insensitive.",
        },
        sort_by: {
          type: "string",
          enum: ["spend", "purchases", "roas", "cpa", "ctr"],
          description: "How to rank the returned ads. Default 'spend'.",
        },
        limit: {
          type: "number",
          description: "Max ads to return (1-100). Default 30.",
        },
      },
    },
  },
  {
    name: "list_deconstructions",
    description:
      "List past creative deconstructions (AI-analyzed ad videos with hook/tone/CTA/scenes) the user has run. Use when the user asks about 'which ads we've analyzed', 'what creatives have I deconstructed', or to find candidates before calling get_ad_deconstruction. Returns compact summaries, not the full analysis.",
    input_schema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Filter to a specific FB ad account ID.",
        },
        since_days: {
          type: "number",
          description:
            "Only include deconstructions from the last N days. Omit for no time filter.",
        },
        limit: {
          type: "number",
          description: "Max rows (1-50). Default 20.",
        },
      },
    },
  },
  {
    name: "get_ad_deconstruction",
    description:
      "Fetch the FULL deconstruction for a specific ad — transcript, hook, scene-by-scene breakdown, visual style, tone, CTA. Use when the user references a specific ad_id or name and wants the creative breakdown. Call list_deconstructions first if you don't know the ad_id.",
    input_schema: {
      type: "object",
      properties: {
        ad_id: {
          type: "string",
          description:
            "Facebook ad ID (numeric string, e.g. '120211234567890123').",
        },
      },
      required: ["ad_id"],
    },
  },
  {
    name: "list_comparative_reports",
    description:
      "List past comparative analyses — these are multi-ad strategy reports produced by the 'Compare & Strategize' tool that tier ads into stable_winner / spike / stable_loser / dead and extract winner DNA. Use when the user asks 'ano yung pinaka recent na comparison?' or wants to reference a past strategic report.",
    input_schema: {
      type: "object",
      properties: {
        store_name: {
          type: "string",
          description:
            "Filter by Shopify store name (e.g. 'CAPSULED', 'I LOVE PATCHES').",
        },
        limit: {
          type: "number",
          description: "Max rows (1-30). Default 10.",
        },
      },
    },
  },
  {
    name: "get_comparative_report",
    description:
      "Fetch the FULL comparative analysis for a report id — includes the tier breakdown, winner DNA (hook patterns, scene beats, tone, CTA patterns, visual style), and the per-ad performance snapshot that fed the analysis. Use when a user wants to dive into the details of a specific past comparison.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "UUID of the comparative analysis row.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_scaling_campaigns",
    description:
      "Get the mapping of Shopify stores → the one Facebook campaign designated as that store's scaling campaign. Use when the user asks 'saan ko ilalagay si X?', 'which campaign is scaling for I LOVE PATCHES?', or needs to know where winners get promoted.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_autopilot_activity",
    description:
      "Get recent autopilot actions — which ads were auto-paused, auto-resumed, or skipped, and why (rule_matched). Use when the user asks 'what did autopilot do?', 'anong ads na-pause ng system?', or is debugging autopilot behavior. Defaults to last 7 days.",
    input_schema: {
      type: "object",
      properties: {
        since_days: {
          type: "number",
          description: "How far back to look. Default 7.",
        },
        action: {
          type: "string",
          enum: ["paused", "resumed", "skipped", "error"],
          description: "Filter to a single action type.",
        },
        limit: {
          type: "number",
          description: "Max rows (1-100). Default 30.",
        },
      },
    },
  },
];

const HANDLERS: Record<string, Handler> = {
  get_ad_performance: (input, ctx) =>
    getAdPerformance(input as Parameters<typeof getAdPerformance>[0], {
      fbToken: ctx.fbToken,
    }),
  list_deconstructions: (input, ctx) =>
    listDeconstructions(input as Parameters<typeof listDeconstructions>[0], {
      supabase: ctx.supabase,
    }),
  get_ad_deconstruction: (input, ctx) =>
    getAdDeconstruction(input as Parameters<typeof getAdDeconstruction>[0], {
      supabase: ctx.supabase,
    }),
  list_comparative_reports: (input, ctx) =>
    listComparativeReports(
      input as Parameters<typeof listComparativeReports>[0],
      { supabase: ctx.supabase }
    ),
  get_comparative_report: (input, ctx) =>
    getComparativeReport(input as Parameters<typeof getComparativeReport>[0], {
      supabase: ctx.supabase,
    }),
  list_scaling_campaigns: (_input, ctx) =>
    listScalingCampaigns({}, { supabase: ctx.supabase }),
  get_autopilot_activity: (input, ctx) =>
    getAutopilotActivity(
      input as Parameters<typeof getAutopilotActivity>[0],
      { supabase: ctx.supabase }
    ),
};

export function buildToolRegistry(role: AgentRole): {
  definitions: ToolDefinition[];
  handlers: Record<string, Handler>;
} {
  const allowed = allowedToolsFor(role);
  const definitions = ALL_DEFINITIONS.filter((d) => allowed.has(d.name));
  const handlers: Record<string, Handler> = {};
  for (const name of Object.keys(HANDLERS)) {
    if (allowed.has(name)) handlers[name] = HANDLERS[name];
  }
  return { definitions, handlers };
}
