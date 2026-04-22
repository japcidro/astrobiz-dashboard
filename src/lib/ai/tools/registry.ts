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
  listAdAccounts,
  getWinners,
  getAdTimeline,
  searchStoreKnowledge,
  compareAdsQuick,
  getDeconstructionsBatch,
  compileWinners,
} from "./marketing";
import { searchOrders, getOrder, listProducts } from "./shopify";
import { getStockAlerts, getRecentNotifications } from "./ops";
import {
  getJtDeliveryStats,
  getPickpackStats,
  getWaybillMismatches,
} from "./fulfillment";
import { getNetProfit } from "./profit";
import { requestDeconstruction } from "./actions";
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
  role: AgentRole;
  // Needed by action tools for per-session quota accounting + audit
  // attribution. Null sessionId is fine for one-off first messages.
  sessionId: string | null;
  employeeId: string;
}

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<unknown>;

// ── Definitions (Anthropic tools API schema) ─────────────────────────
const ALL_DEFINITIONS: ToolDefinition[] = [
  // ── MARKETING ──
  {
    name: "list_ad_accounts",
    description:
      "Fast discovery: list all connected Facebook ad accounts with name + status. ALWAYS call this first when the user mentions a store/brand but you don't know the FB account_id yet — do NOT default to account_filter='ALL' on get_ad_performance because it's slow. Example match: user says 'CAPSULED ads' → call list_ad_accounts → find the account named like CAPSULED → pass its id to get_ad_performance.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_ad_performance",
    description:
      "Pull live Facebook Ads performance for the date range the user implies. Returns per-ad metrics (spend, purchases, ROAS, CPP/cpa, CTR) plus totals. PREFER passing account_filter to a specific account ID — 'ALL' queries every account sequentially and is slow (50s+). If you don't know the account ID yet, call list_ad_accounts first.",
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
            "last_90d",
            "this_month",
            "last_month",
            "lifetime",
          ],
          description:
            "Which date range to pull. Infer from user message. For single-period questions ('this week' → last_7d, 'yesterday' → yesterday). For retrospective/compilation questions ('lahat ng winners', 'every ad that hit X purchases', 'all-time'), use last_90d or lifetime so you don't miss ads that already wound down.",
        },
        account_filter: {
          type: "string",
          description:
            "Specific FB ad account ID (e.g. 'act_123...') to narrow the query. Strongly recommended. Default is 'ALL' (slow).",
        },
        min_spend: { type: "number", description: "Only return ads with spend >= this (₱)." },
        min_purchases: { type: "number", description: "Only return ads with purchases >= this." },
        status: {
          type: "string",
          description: "Filter to FB delivery status, e.g. 'ACTIVE'. Case insensitive.",
        },
        sort_by: {
          type: "string",
          enum: ["spend", "purchases", "roas", "cpa", "ctr"],
          description: "How to rank the returned ads. Default 'spend'.",
        },
        limit: { type: "number", description: "Max ads to return (1-100). Default 30." },
      },
    },
  },
  {
    name: "get_winners",
    description:
      "Applies the canonical winner criteria (CPP < ₱200, ≥3 purchases/day, ≥2 consecutive days) to rank ads in a specific account as stable_winner / spike / stable_loser / dead. This is the right tool when the user asks 'anong winners ko?' or 'may stable winners ba?' — it's slower than get_ad_performance because it pulls daily metrics per ad, but gives consistency analysis not just raw ranking. Needs account_filter (ALL is rejected for speed).",
    input_schema: {
      type: "object",
      properties: {
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d", "last_90d", "lifetime"],
          description: "Window to analyze. Default last_7d.",
        },
        account_filter: { type: "string", description: "FB ad account ID. Required." },
        max_ads_to_check: {
          type: "number",
          description: "Cap on ads to analyze per call (1-50). Default 20.",
        },
        min_spend: {
          type: "number",
          description: "Ignore ads below this spend threshold. Default ₱500.",
        },
      },
      required: ["account_filter"],
    },
  },
  {
    name: "get_ad_timeline",
    description:
      "Day-by-day metrics for a SINGLE ad. Use when the user asks if an ad is consistent ('1-day spike ba yun o stable?') or wants the timeline of a specific ad. Returns daily spend/purchases/CPP/ROAS plus the winner classification.",
    input_schema: {
      type: "object",
      properties: {
        ad_id: { type: "string", description: "Facebook ad ID (numeric string)." },
        account_id: {
          type: "string",
          description: "FB ad account ID that owns this ad (format 'act_...').",
        },
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d", "last_90d", "lifetime"],
          description: "Window to pull. Default last_7d.",
        },
      },
      required: ["ad_id", "account_id"],
    },
  },
  {
    name: "list_deconstructions",
    description:
      "List past creative deconstructions (AI-analyzed ad videos with hook/tone/CTA). Use when the user asks 'what creatives have I deconstructed?' or to find candidates before get_ad_deconstruction. Returns compact summaries, not full analysis.",
    input_schema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Filter to a specific FB ad account." },
        since_days: {
          type: "number",
          description: "Only include deconstructions from the last N days.",
        },
        limit: { type: "number", description: "Max rows (1-50). Default 20." },
      },
    },
  },
  {
    name: "get_ad_deconstruction",
    description:
      "Fetch the FULL deconstruction for a specific ad — transcript, hook, scene-by-scene breakdown, visual style, tone, CTA. Call list_deconstructions first if you don't know the ad_id.",
    input_schema: {
      type: "object",
      properties: {
        ad_id: { type: "string", description: "Facebook ad ID (numeric string)." },
      },
      required: ["ad_id"],
    },
  },
  {
    name: "list_comparative_reports",
    description:
      "List past Compare & Strategize reports — multi-ad strategy reports with tier breakdown (stable_winner / spike / stable_loser / dead) and winner DNA extraction. Use when the user references a past strategic report.",
    input_schema: {
      type: "object",
      properties: {
        store_name: {
          type: "string",
          description: "Filter by Shopify store name (e.g. 'CAPSULED', 'I LOVE PATCHES').",
        },
        limit: { type: "number", description: "Max rows (1-30). Default 10." },
      },
    },
  },
  {
    name: "get_comparative_report",
    description:
      "Fetch the FULL comparative analysis for a report id — tier breakdown + winner DNA (hook patterns, scene beats, tone, CTA patterns, visual style) + per-ad performance snapshot.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "UUID of the comparative analysis row." } },
      required: ["id"],
    },
  },
  {
    name: "compare_ads_quick",
    description:
      "Fast side-by-side comparison of 2-10 ads — pulls each ad's deconstruction (hook/tone/CTA) and optionally live daily metrics. Much faster than the full Claude Opus comparative analysis. Use for 'anong pagkakaiba ng X at Y?' questions. Include account_id to get metrics + consistency tier; omit for deconstruction-only.",
    input_schema: {
      type: "object",
      properties: {
        ad_ids: {
          type: "array",
          items: { type: "string" },
          description: "2-10 FB ad IDs to compare.",
        },
        account_id: {
          type: "string",
          description: "Optional. FB ad account ID for metrics pull.",
        },
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d", "last_90d", "lifetime"],
          description: "Window for metrics (if account_id is provided). Default last_7d.",
        },
      },
      required: ["ad_ids"],
    },
  },
  {
    name: "compile_winners",
    description:
      "SPECIALIST TOOL — use for 'compile all winners' / 'every ad with X' / 'lahat ng ads na may ≥N purchases' requests. Does ad_performance + filter + deconstruction lookup in ONE call. Returns compact rows with spend/purchases/CPP/ROAS PLUS deconstruction preview (hook, tone, CTA) if it exists, or flags the ad as missing. Pair with request_deconstruction for filling in gaps. Much faster and cheaper than calling get_ad_performance + get_ad_deconstruction separately.",
    input_schema: {
      type: "object",
      properties: {
        account_filter: {
          type: "string",
          description:
            "Specific FB ad account ID (required — 'ALL' is rejected for speed). Get it from list_scaling_campaigns.",
        },
        date_preset: {
          type: "string",
          enum: [
            "last_7d",
            "last_14d",
            "last_30d",
            "last_90d",
            "this_month",
            "last_month",
            "lifetime",
          ],
          description:
            "Window to scan. Default last_90d for compilation. Use lifetime for all-time.",
        },
        max_cpp: {
          type: "number",
          description: "CPP ceiling (peso). Default ₱280. Set from user's criteria.",
        },
        min_purchases: {
          type: "number",
          description: "Minimum cumulative purchases. Default 10.",
        },
        min_roas: { type: "number", description: "Optional ROAS floor." },
        min_spend: { type: "number", description: "Optional spend floor (peso)." },
        limit: { type: "number", description: "Max rows. Default 20, max 50." },
      },
      required: ["account_filter"],
    },
  },
  {
    name: "get_deconstructions_batch",
    description:
      "Fetch multiple creative deconstructions in ONE call — more efficient than calling get_ad_deconstruction N times. Use when you have a list of ad_ids (e.g. from compile_winners) and need hook/tone/CTA/scenes/transcript for all of them.",
    input_schema: {
      type: "object",
      properties: {
        ad_ids: {
          type: "array",
          items: { type: "string" },
          description: "Up to 20 FB ad IDs.",
        },
        include_full_transcript: {
          type: "boolean",
          description:
            "If true, returns full transcripts. Default false (500-char previews only) to save tokens.",
        },
      },
      required: ["ad_ids"],
    },
  },
  {
    name: "list_scaling_campaigns",
    description:
      "Get the mapping of Shopify stores → the ONE Facebook campaign designated as that store's scaling campaign. Use when the user asks 'saan ko ilalagay si X?' or 'which campaign is scaling for STORE?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_autopilot_activity",
    description:
      "Recent autopilot actions — which ads were auto-paused / resumed / skipped, and why. Use for 'what did autopilot do?' or 'anong ads na-pause ng system?'.",
    input_schema: {
      type: "object",
      properties: {
        since_days: { type: "number", description: "How far back. Default 7." },
        action: {
          type: "string",
          enum: ["paused", "resumed", "skipped", "error"],
          description: "Filter to one action type.",
        },
        limit: { type: "number", description: "Max rows (1-100). Default 30." },
      },
    },
  },
  {
    name: "search_store_knowledge",
    description:
      "Query the per-store brand knowledge docs (Avatar, Winning Template, Market Sophistication, New Mechanism, etc.). Use this when recommending creative angles or when the user asks 'does this align with the brand strategy?'. Doc types: avatar_training, winning_ad_template, market_sophistication, new_information, new_mechanism, market_research.",
    input_schema: {
      type: "object",
      properties: {
        store_name: { type: "string", description: "Shopify store name to scope the search." },
        doc_type: {
          type: "string",
          description:
            "Filter to one doc type. Valid: avatar_training, winning_ad_template, market_sophistication, new_information, new_mechanism, market_research.",
        },
        query: {
          type: "string",
          description: "Optional keyword to search within title/content.",
        },
      },
    },
  },
  // ── SHOPIFY ──
  {
    name: "search_orders",
    description:
      "List Shopify orders with filters (date range, fulfillment status, financial status, store). Returns order summaries with line items + customer + shipping address + COD vs Prepaid + tracking. Use for 'anong orders last week?', 'may unfulfilled pa ba?', 'COD rate?'.",
    input_schema: {
      type: "object",
      properties: {
        store_name: { type: "string", description: "Shopify store name, or omit for all active stores." },
        date_filter: {
          type: "string",
          enum: ["today", "yesterday", "last_7d", "this_month", "last_30d", "custom"],
          description: "Default 'today'.",
        },
        date_from: { type: "string", description: "ISO date if date_filter=custom." },
        date_to: { type: "string", description: "ISO date if date_filter=custom." },
        financial_status: {
          type: "string",
          description: "Shopify financial status: paid, pending, refunded, voided, partially_paid, etc.",
        },
        fulfillment_status: {
          type: "string",
          description: "Shopify fulfillment status: fulfilled, unfulfilled, partial, restocked.",
        },
        limit: { type: "number", description: "Max orders returned (1-100). Default 50." },
      },
    },
  },
  {
    name: "get_order",
    description:
      "Fetch a single Shopify order by order number (e.g. '#1234' or '1234'). Returns full line items + customer + shipping + tracking. Use for specific order lookups.",
    input_schema: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "The order name/number, with or without leading #." },
        store_name: {
          type: "string",
          description: "Shopify store name. Omit to search all stores (slower but necessary if you don't know which store).",
        },
      },
      required: ["order_number"],
    },
  },
  {
    name: "list_products",
    description:
      "List Shopify product variants with stock levels. Supports low-stock filtering. Use for 'anong ubos na stock?', 'ilan units ng SKU X?', 'how much inventory ng STORE?'.",
    input_schema: {
      type: "object",
      properties: {
        store_name: { type: "string", description: "Shopify store to query." },
        search: { type: "string", description: "Title substring filter." },
        low_stock: { type: "boolean", description: "Only return variants below threshold." },
        low_stock_threshold: {
          type: "number",
          description: "Qty under which a variant is 'low stock'. Default 10.",
        },
        limit: { type: "number", description: "Max variants (1-100). Default 50." },
      },
    },
  },
  // ── OPS ──
  {
    name: "get_stock_alerts",
    description:
      "Get stock-relevant alerts from admin_alerts — winners running out of stock, restocked winners, new winners. Use for 'may winner ba akong naubusan?', 'anong restocks natin?'.",
    input_schema: {
      type: "object",
      properties: {
        unread_only: { type: "boolean", description: "Only return unread alerts." },
        limit: { type: "number", description: "Max rows (1-50). Default 20." },
      },
    },
  },
  {
    name: "get_recent_notifications",
    description:
      "Get the full stream of admin alerts (filtered by relevance to the caller's role). Use for 'anong recent notifications ko?', 'may urgent ba?'. Marketing role sees only ad-relevant alerts; admin sees everything including RTS spikes + cash at risk.",
    input_schema: {
      type: "object",
      properties: {
        unread_only: { type: "boolean", description: "Only unread." },
        limit: { type: "number", description: "Max rows (1-50). Default 20." },
      },
    },
  },
  // ── FULFILLMENT (admin-only) ──
  {
    name: "get_jt_delivery_stats",
    description:
      "ADMIN ONLY. Rollup of J&T deliveries — delivered rate, RTS rate, per-store breakdown, top RTS reasons. Use for 'anong RTS rate this week?', 'which store has the most returns?'.",
    input_schema: {
      type: "object",
      properties: {
        since_days: { type: "number", description: "How many days back. Default 30." },
        date_from: { type: "string", description: "ISO date override." },
        date_to: { type: "string", description: "ISO date override." },
        store_name: { type: "string", description: "Filter to one store." },
      },
    },
  },
  {
    name: "get_pickpack_stats",
    description:
      "ADMIN ONLY. Pack throughput + mismatch stats per employee from pack_verifications. Use for 'who's slowest sa pick-pack?', 'ilan packs this week?'.",
    input_schema: {
      type: "object",
      properties: {
        since_days: { type: "number", description: "How many days back. Default 7." },
        date_from: { type: "string", description: "ISO date override." },
        date_to: { type: "string", description: "ISO date override." },
        employee_id: { type: "string", description: "UUID of a specific employee to scope to." },
      },
    },
  },
  {
    name: "get_waybill_mismatches",
    description:
      "ADMIN ONLY. Lists cases where packer selected the WRONG sender store on a J&T label (expected_store ≠ actual_sender). Use for 'any waybill mismatches?', 'sino nag-packed ng CAPSULED with I LOVE PATCHES label?'.",
    input_schema: {
      type: "object",
      properties: {
        since_days: { type: "number", description: "How many days back. Default 7." },
        date_from: { type: "string", description: "ISO date override." },
        date_to: { type: "string", description: "ISO date override." },
      },
    },
  },
  // ── ACTIONS (admin-only) ──
  {
    name: "request_deconstruction",
    description:
      "ADMIN ONLY. ACTION TOOL — triggers a Gemini video analysis for an ad that hasn't been deconstructed yet. Takes 30-90 seconds per call. IDEMPOTENT: if the ad is already deconstructed and fresh (<7 days old), returns the cached row instead of re-running. Use this when compile_winners reports missing_deconstructions — ask the user first if they want you to fill in the gaps, then call for each ad_id. Max 10 calls per session (enforced by quota).",
    input_schema: {
      type: "object",
      properties: {
        ad_id: {
          type: "string",
          description: "Facebook ad ID (numeric string).",
        },
        account_id: {
          type: "string",
          description: "FB ad account ID (format 'act_...').",
        },
        force_refresh: {
          type: "boolean",
          description:
            "Force re-run even if a fresh deconstruction exists. Default false.",
        },
      },
      required: ["ad_id", "account_id"],
    },
  },
  // ── PROFIT (admin-only) ──
  {
    name: "get_net_profit",
    description:
      "ADMIN ONLY. Net profit P&L — revenue, COGS, ad spend, shipping, returns value, net profit, margin %. Supports per-store filter and date ranges. Use ONLY when the admin asks about profit/P&L/margin. Never discuss this output in a marketing context.",
    input_schema: {
      type: "object",
      properties: {
        date_filter: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "last_7d",
            "this_month",
            "last_month",
            "last_30d",
            "last_90d",
            "custom",
          ],
          description: "Default 'today'.",
        },
        date_from: { type: "string", description: "ISO date if date_filter=custom." },
        date_to: { type: "string", description: "ISO date if date_filter=custom." },
        store_name: { type: "string", description: "Filter to one Shopify store." },
      },
    },
  },
];

const HANDLERS: Record<string, Handler> = {
  // Marketing
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
    getAutopilotActivity(input as Parameters<typeof getAutopilotActivity>[0], {
      supabase: ctx.supabase,
    }),
  list_ad_accounts: (_input, ctx) =>
    listAdAccounts({}, { fbToken: ctx.fbToken }),
  get_winners: (input, ctx) =>
    getWinners(input as Parameters<typeof getWinners>[0], {
      fbToken: ctx.fbToken,
    }),
  get_ad_timeline: (input, ctx) =>
    getAdTimeline(input as Parameters<typeof getAdTimeline>[0], {
      fbToken: ctx.fbToken,
    }),
  search_store_knowledge: (input, ctx) =>
    searchStoreKnowledge(
      input as Parameters<typeof searchStoreKnowledge>[0],
      { supabase: ctx.supabase }
    ),
  compare_ads_quick: (input, ctx) =>
    compareAdsQuick(input as Parameters<typeof compareAdsQuick>[0], {
      supabase: ctx.supabase,
      fbToken: ctx.fbToken,
    }),
  compile_winners: (input, ctx) =>
    compileWinners(input as Parameters<typeof compileWinners>[0], {
      fbToken: ctx.fbToken,
      supabase: ctx.supabase,
    }),
  get_deconstructions_batch: (input, ctx) =>
    getDeconstructionsBatch(
      input as Parameters<typeof getDeconstructionsBatch>[0],
      { supabase: ctx.supabase }
    ),
  // Shopify
  search_orders: (input, ctx) =>
    searchOrders(input as Parameters<typeof searchOrders>[0], {
      supabase: ctx.supabase,
    }),
  get_order: (input, ctx) =>
    getOrder(input as Parameters<typeof getOrder>[0], {
      supabase: ctx.supabase,
    }),
  list_products: (input, ctx) =>
    listProducts(input as Parameters<typeof listProducts>[0], {
      supabase: ctx.supabase,
    }),
  // Ops
  get_stock_alerts: (input, ctx) =>
    getStockAlerts(input as Parameters<typeof getStockAlerts>[0], {
      supabase: ctx.supabase,
    }),
  get_recent_notifications: (input, ctx) =>
    getRecentNotifications(
      {
        ...(input as { unread_only?: boolean; limit?: number }),
        role: ctx.role,
      },
      { supabase: ctx.supabase }
    ),
  // Fulfillment (admin-only)
  get_jt_delivery_stats: (input, ctx) =>
    getJtDeliveryStats(input as Parameters<typeof getJtDeliveryStats>[0], {
      supabase: ctx.supabase,
    }),
  get_pickpack_stats: (input, ctx) =>
    getPickpackStats(input as Parameters<typeof getPickpackStats>[0], {
      supabase: ctx.supabase,
    }),
  get_waybill_mismatches: (input, ctx) =>
    getWaybillMismatches(
      input as Parameters<typeof getWaybillMismatches>[0],
      { supabase: ctx.supabase }
    ),
  // Profit (admin-only)
  get_net_profit: (input) =>
    getNetProfit(input as Parameters<typeof getNetProfit>[0]),
  // Actions (admin-only)
  request_deconstruction: (input, ctx) =>
    requestDeconstruction(
      input as Parameters<typeof requestDeconstruction>[0],
      {
        supabase: ctx.supabase,
        fbToken: ctx.fbToken,
        sessionId: ctx.sessionId,
        employeeId: ctx.employeeId,
      }
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
