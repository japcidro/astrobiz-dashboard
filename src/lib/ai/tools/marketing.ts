// Tool handlers for marketing-domain AI queries. Each handler returns a
// compact JSON blob that Claude can reason over — we keep rows tight and
// avoid sending the full analysis JSON when a short summary suffices,
// since tool results go back into the next Anthropic call and cost tokens.
//
// All handlers use the service client: the caller (agent loop) has already
// verified the employee's role via allowedToolsFor(). Row-level RLS is
// deliberately bypassed so marketing can see data that lives behind
// admin-only RLS (scaling campaigns, autopilot actions) but ONLY the
// exact fields we surface here.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAdPerformance,
  type DatePreset,
  type AdRow,
} from "@/lib/fb-ads-module/fetch-performance";

const VALID_DATE_PRESETS: DatePreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
];

function coerceDatePreset(raw: unknown): DatePreset {
  if (typeof raw === "string" && (VALID_DATE_PRESETS as string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "last_7d";
}

function round(n: number, decimals = 2): number {
  const p = Math.pow(10, decimals);
  return Math.round(n * p) / p;
}

// ─── 1. get_ad_performance ────────────────────────────────────────────
// Live pull from Facebook Marketing API via the shared fetcher the UI
// already uses. Returns a compact list, not the huge AdRow payload.
export async function getAdPerformance(
  input: {
    date_preset?: string;
    account_filter?: string;
    min_spend?: number;
    min_purchases?: number;
    status?: string;
    limit?: number;
    sort_by?: "spend" | "purchases" | "roas" | "cpa" | "ctr";
  },
  ctx: { fbToken: string }
): Promise<{
  date_preset: string;
  account_filter: string;
  total_ads: number;
  totals: {
    spend: number;
    purchases: number;
    roas: number;
    cpa: number;
    ctr: number;
  };
  ads: Array<{
    ad_id: string;
    ad: string;
    adset: string;
    campaign: string;
    account: string;
    status: string;
    spend: number;
    purchases: number;
    roas: number;
    cpa: number;
    ctr: number;
  }>;
}> {
  const datePreset = coerceDatePreset(input.date_preset);
  const accountFilter = input.account_filter ?? "ALL";
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const sortBy = input.sort_by ?? "spend";

  const result = await fetchAdPerformance({
    token: ctx.fbToken,
    datePreset,
    accountFilter,
  });

  let rows: AdRow[] = result.data;
  if (typeof input.min_spend === "number") {
    rows = rows.filter((r) => r.spend >= input.min_spend!);
  }
  if (typeof input.min_purchases === "number") {
    rows = rows.filter((r) => r.purchases >= input.min_purchases!);
  }
  if (input.status) {
    const want = input.status.toUpperCase();
    rows = rows.filter((r) => r.status === want);
  }

  rows = [...rows].sort((a, b) => {
    if (sortBy === "cpa") {
      // lower is better; 0-purchase ads have CPA=0, sink them.
      const aVal = a.purchases > 0 ? a.cpa : Number.POSITIVE_INFINITY;
      const bVal = b.purchases > 0 ? b.cpa : Number.POSITIVE_INFINITY;
      return aVal - bVal;
    }
    const key = sortBy as keyof AdRow;
    return (b[key] as number) - (a[key] as number);
  });

  return {
    date_preset: datePreset,
    account_filter: accountFilter,
    total_ads: result.data.length,
    totals: {
      spend: round(result.totals.spend),
      purchases: result.totals.purchases,
      roas: round(result.totals.roas),
      cpa: round(result.totals.cpa),
      ctr: round(result.totals.ctr * 100, 2),
    },
    ads: rows.slice(0, limit).map((r) => ({
      ad_id: r.ad_id,
      ad: r.ad,
      adset: r.adset,
      campaign: r.campaign,
      account: r.account,
      status: r.status,
      spend: round(r.spend),
      purchases: r.purchases,
      roas: round(r.roas),
      cpa: round(r.cpa),
      ctr: round(r.ctr * 100, 2),
    })),
  };
}

// ─── 2. list_deconstructions ──────────────────────────────────────────
export async function listDeconstructions(
  input: { account_id?: string; since_days?: number; limit?: number },
  ctx: { supabase: SupabaseClient }
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  let query = ctx.supabase
    .from("ad_creative_analyses")
    .select(
      "id, ad_id, account_id, thumbnail_url, model, trigger_source, created_at, analysis"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.account_id) query = query.eq("account_id", input.account_id);
  if (input.since_days) {
    const cutoff = new Date(
      Date.now() - input.since_days * 86400_000
    ).toISOString();
    query = query.gte("created_at", cutoff);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return {
    count: data?.length ?? 0,
    deconstructions: (data ?? []).map((r) => {
      const a = r.analysis as {
        hook?: { description?: string };
        tone?: string;
        cta?: string;
        duration_seconds?: number;
      };
      return {
        id: r.id,
        ad_id: r.ad_id,
        account_id: r.account_id,
        created_at: r.created_at,
        hook: a?.hook?.description?.slice(0, 200) ?? null,
        tone: a?.tone ?? null,
        cta: a?.cta?.slice(0, 200) ?? null,
        duration_seconds: a?.duration_seconds ?? null,
        trigger_source: r.trigger_source,
      };
    }),
  };
}

// ─── 3. get_ad_deconstruction ─────────────────────────────────────────
export async function getAdDeconstruction(
  input: { ad_id: string },
  ctx: { supabase: SupabaseClient }
) {
  if (!input.ad_id) {
    return { error: "ad_id is required" };
  }
  const { data, error } = await ctx.supabase
    .from("ad_creative_analyses")
    .select(
      "id, ad_id, account_id, thumbnail_url, analysis, model, trigger_source, created_at"
    )
    .eq("ad_id", input.ad_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { found: false, ad_id: input.ad_id };

  return {
    found: true,
    id: data.id,
    ad_id: data.ad_id,
    account_id: data.account_id,
    thumbnail_url: data.thumbnail_url,
    created_at: data.created_at,
    model: data.model,
    trigger_source: data.trigger_source,
    analysis: data.analysis,
  };
}

// ─── 4. list_comparative_reports ──────────────────────────────────────
export async function listComparativeReports(
  input: { store_name?: string; limit?: number },
  ctx: { supabase: SupabaseClient }
) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 30);
  let query = ctx.supabase
    .from("ad_comparative_analyses")
    .select("id, ad_ids, store_name, date_preset, model, created_at, analysis")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.store_name) query = query.eq("store_name", input.store_name);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return {
    count: data?.length ?? 0,
    reports: (data ?? []).map((r) => {
      const a = r.analysis as { summary?: string };
      const adIds = r.ad_ids as string[] | null;
      return {
        id: r.id,
        store_name: r.store_name,
        date_preset: r.date_preset,
        ad_count: adIds?.length ?? 0,
        created_at: r.created_at,
        summary: a?.summary?.slice(0, 300) ?? null,
      };
    }),
  };
}

// ─── 5. get_comparative_report ────────────────────────────────────────
export async function getComparativeReport(
  input: { id: string },
  ctx: { supabase: SupabaseClient }
) {
  if (!input.id) return { error: "id is required" };
  const { data, error } = await ctx.supabase
    .from("ad_comparative_analyses")
    .select(
      "id, ad_ids, store_name, date_preset, model, created_at, analysis, inputs_snapshot"
    )
    .eq("id", input.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { found: false, id: input.id };

  return {
    found: true,
    id: data.id,
    store_name: data.store_name,
    date_preset: data.date_preset,
    ad_ids: data.ad_ids,
    model: data.model,
    created_at: data.created_at,
    analysis: data.analysis,
    inputs_snapshot: data.inputs_snapshot,
  };
}

// ─── 6. list_scaling_campaigns ────────────────────────────────────────
export async function listScalingCampaigns(
  _input: Record<string, never>,
  ctx: { supabase: SupabaseClient }
) {
  const { data, error } = await ctx.supabase
    .from("store_scaling_campaigns")
    .select(
      "id, store_name, account_id, campaign_id, campaign_name, updated_at"
    )
    .order("store_name", { ascending: true });

  if (error) throw new Error(error.message);

  return {
    count: data?.length ?? 0,
    scaling_campaigns: data ?? [],
  };
}

// ─── 7. get_autopilot_activity ────────────────────────────────────────
export async function getAutopilotActivity(
  input: {
    since_days?: number;
    action?: "paused" | "resumed" | "skipped" | "error";
    limit?: number;
  },
  ctx: { supabase: SupabaseClient }
) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const since = new Date(
    Date.now() - (input.since_days ?? 7) * 86400_000
  ).toISOString();

  let query = ctx.supabase
    .from("autopilot_actions")
    .select(
      "id, action, ad_id, ad_name, adset_name, campaign_name, account_id, rule_matched, spend, purchases, cpa, status, error_message, created_at"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.action) query = query.eq("action", input.action);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const byAction = new Map<string, number>();
  for (const row of data ?? []) {
    byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
  }

  return {
    since_days: input.since_days ?? 7,
    total_actions: data?.length ?? 0,
    by_action: Object.fromEntries(byAction),
    actions: data ?? [],
  };
}
