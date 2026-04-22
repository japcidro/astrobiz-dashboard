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
import {
  fetchAdDailyInsights,
  classifyConsistency,
  DEFAULT_WINNER_THRESHOLDS,
} from "@/lib/facebook/insights-daily";

const VALID_DATE_PRESETS: DatePreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "lifetime",
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

// ─── 8. list_ad_accounts ──────────────────────────────────────────────
// Fast discovery: one small FB call to /me/adaccounts, no insights.
// Lets the model narrow the scope BEFORE hitting the slow get_ad_performance
// (which iterates campaigns+adsets+ads+insights per account).
export async function listAdAccounts(
  _input: Record<string, never>,
  ctx: { fbToken: string }
): Promise<{
  count: number;
  accounts: Array<{
    id: string;
    account_id: string;
    name: string;
    status: string;
    is_active: boolean;
  }>;
}> {
  const url = `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${encodeURIComponent(ctx.fbToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
        `FB adaccounts error ${res.status}`
    );
  }
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      account_id: string;
      account_status: number;
    }>;
  };
  const STATUS: Record<number, string> = {
    1: "ACTIVE",
    2: "DISABLED",
    3: "UNSETTLED",
    7: "PENDING_REVIEW",
    8: "PENDING_SETTLEMENT",
    9: "GRACE_PERIOD",
    100: "PENDING_CLOSURE",
    101: "CLOSED",
  };
  const accounts = (json.data ?? []).map((a) => ({
    id: a.id,
    account_id: a.account_id,
    name: a.name,
    status: STATUS[a.account_status] ?? "UNKNOWN",
    is_active: a.account_status === 1,
  }));
  return { count: accounts.length, accounts };
}

// ─── 9. get_winners ───────────────────────────────────────────────────
// Applies the project's canonical winner criteria (CPP < ₱200,
// ≥3 purchases/day, 2+ consecutive days) across all ads in the selection.
// Needs an account_filter since it has to run fetchAdDailyInsights per ad.
export async function getWinners(
  input: {
    date_preset?: string;
    account_filter?: string;
    max_ads_to_check?: number;
    min_spend?: number;
  },
  ctx: { fbToken: string }
) {
  const datePreset = coerceDatePreset(input.date_preset);
  const accountFilter = input.account_filter ?? "ALL";
  if (accountFilter === "ALL") {
    return {
      error:
        "get_winners needs account_filter (call list_ad_accounts first). Scanning every account for daily winner consistency is too slow — narrow to one account.",
    };
  }
  const maxToCheck = Math.min(Math.max(input.max_ads_to_check ?? 20, 1), 50);
  const minSpend = input.min_spend ?? 500;

  const perf = await fetchAdPerformance({
    token: ctx.fbToken,
    datePreset,
    accountFilter,
  });
  const candidates = perf.data
    .filter((r) => r.spend >= minSpend && r.purchases > 0)
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, maxToCheck);

  if (candidates.length === 0) {
    return {
      date_preset: datePreset,
      account_filter: accountFilter,
      checked: 0,
      winners: [],
      spikes: [],
      note: "No ads with purchases >= 1 and spend >= ₱" + minSpend + " in this range.",
    };
  }

  // Parallel (capped at 4) per-ad daily insights pulls.
  const CONCURRENCY = 4;
  const classified: Array<{
    ad_id: string;
    ad: string;
    campaign: string;
    adset: string;
    tier: string;
    winning_days: number;
    max_consecutive: number;
    total: { spend: number; purchases: number; cpp: number; roas: number };
  }> = [];

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const slice = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (ad) => {
        try {
          const metrics = await fetchAdDailyInsights(
            ad.ad_id,
            ad.account_id,
            ctx.fbToken,
            datePreset as DatePreset
          );
          const c = classifyConsistency(metrics, DEFAULT_WINNER_THRESHOLDS);
          return {
            ad_id: ad.ad_id,
            ad: ad.ad,
            campaign: ad.campaign,
            adset: ad.adset,
            tier: c.tier,
            winning_days: c.winning_days,
            max_consecutive: c.max_consecutive,
            total: {
              spend: round(metrics.total.spend),
              purchases: metrics.total.purchases,
              cpp: round(metrics.total.cpp),
              roas: round(metrics.total.roas),
            },
          };
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r) classified.push(r);
  }

  return {
    date_preset: datePreset,
    account_filter: accountFilter,
    criteria: {
      max_cpp: DEFAULT_WINNER_THRESHOLDS.max_cpp,
      min_purchases_per_day: DEFAULT_WINNER_THRESHOLDS.min_purchases_per_day,
      min_consecutive_days: DEFAULT_WINNER_THRESHOLDS.min_consecutive_days,
    },
    checked: candidates.length,
    winners: classified.filter((c) => c.tier === "stable_winner"),
    spikes: classified.filter((c) => c.tier === "spike"),
    stable_losers: classified.filter((c) => c.tier === "stable_loser"),
  };
}

// ─── 10. get_ad_timeline ──────────────────────────────────────────────
// Day-by-day metrics for a single ad so the model can answer "consistent
// ba si X o 1-day spike?" without pulling the whole account.
export async function getAdTimeline(
  input: { ad_id: string; account_id: string; date_preset?: string },
  ctx: { fbToken: string }
) {
  if (!input.ad_id || !input.account_id) {
    return { error: "ad_id and account_id are required" };
  }
  const datePreset = coerceDatePreset(input.date_preset);
  const metrics = await fetchAdDailyInsights(
    input.ad_id,
    input.account_id,
    ctx.fbToken,
    datePreset as DatePreset
  );
  const classification = classifyConsistency(
    metrics,
    DEFAULT_WINNER_THRESHOLDS
  );
  return {
    ad_id: input.ad_id,
    date_preset: datePreset,
    tier: classification.tier,
    winning_days: classification.winning_days,
    max_consecutive: classification.max_consecutive,
    total: {
      spend: round(metrics.total.spend),
      purchases: metrics.total.purchases,
      purchase_value: round(metrics.total.purchase_value),
      cpp: round(metrics.total.cpp),
      roas: round(metrics.total.roas),
      ctr: round(metrics.total.ctr * 100, 2),
    },
    daily: metrics.daily.map((d) => ({
      date: d.date,
      spend: round(d.spend),
      purchases: d.purchases,
      cpp: round(d.cpp),
      roas: round(d.roas),
      ctr: round(d.ctr * 100, 2),
    })),
  };
}

// ─── 11. search_store_knowledge ───────────────────────────────────────
// Returns per-store brand docs (Avatar, Winning Template, Market Soph,
// etc.) so the AI can reference the store's own strategy when
// recommending angles/creatives. Skips the system_* docs — those are
// tool-specific prompts for the Angle/Script generator, not context.
export async function searchStoreKnowledge(
  input: { store_name?: string; doc_type?: string; query?: string },
  ctx: { supabase: SupabaseClient }
) {
  let query = ctx.supabase
    .from("ai_store_docs")
    .select("store_name, doc_type, title, content, updated_at")
    .order("updated_at", { ascending: false });

  if (input.store_name) query = query.eq("store_name", input.store_name);
  if (input.doc_type) query = query.eq("doc_type", input.doc_type);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data ?? []).filter((d) => !String(d.doc_type).startsWith("system_"));

  if (input.query) {
    const q = input.query.toLowerCase();
    rows = rows.filter(
      (d) =>
        String(d.title ?? "").toLowerCase().includes(q) ||
        String(d.content ?? "").toLowerCase().includes(q)
    );
  }

  // Trim content previews — full docs can be 5k+ chars each.
  return {
    count: rows.length,
    docs: rows.map((d) => ({
      store_name: d.store_name,
      doc_type: d.doc_type,
      title: d.title,
      content: typeof d.content === "string" ? d.content.slice(0, 3000) : d.content,
      updated_at: d.updated_at,
      truncated:
        typeof d.content === "string" && d.content.length > 3000,
    })),
  };
}

// ─── 12. compare_ads_quick ────────────────────────────────────────────
// Side-by-side metrics + deconstruction hook/tone/cta previews for 2-10
// ads. Much faster than the full Claude Opus comparative report — use
// for "anong pagkakaiba?" questions, then suggest the full compare.
export async function compareAdsQuick(
  input: { ad_ids: string[]; date_preset?: string; account_id?: string },
  ctx: { supabase: SupabaseClient; fbToken: string }
) {
  const adIds = Array.isArray(input.ad_ids)
    ? [...new Set(input.ad_ids.filter(Boolean))].slice(0, 10)
    : [];
  if (adIds.length < 2) {
    return { error: "Provide at least 2 and at most 10 ad_ids." };
  }
  const datePreset = coerceDatePreset(input.date_preset);

  // Parallel: deconstructions from Supabase + daily insights from FB.
  const [deconRes, dailyResults] = await Promise.all([
    ctx.supabase
      .from("ad_creative_analyses")
      .select("ad_id, account_id, thumbnail_url, analysis")
      .in("ad_id", adIds),
    (async () => {
      if (!input.account_id) return [];
      const CONCURRENCY = 4;
      const out: Array<{ ad_id: string; total: unknown; tier: string }> = [];
      for (let i = 0; i < adIds.length; i += CONCURRENCY) {
        const slice = adIds.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          slice.map(async (adId) => {
            try {
              const metrics = await fetchAdDailyInsights(
                adId,
                input.account_id!,
                ctx.fbToken,
                datePreset as DatePreset
              );
              const c = classifyConsistency(metrics, DEFAULT_WINNER_THRESHOLDS);
              return {
                ad_id: adId,
                total: {
                  spend: round(metrics.total.spend),
                  purchases: metrics.total.purchases,
                  cpp: round(metrics.total.cpp),
                  roas: round(metrics.total.roas),
                  ctr: round(metrics.total.ctr * 100, 2),
                },
                tier: c.tier,
              };
            } catch {
              return null;
            }
          })
        );
        for (const r of results) if (r) out.push(r);
      }
      return out;
    })(),
  ]);

  const deconRows = deconRes.data ?? [];
  const byAdId = new Map<string, (typeof dailyResults)[number]>();
  for (const r of dailyResults) byAdId.set(r.ad_id, r);

  return {
    date_preset: datePreset,
    ads: adIds.map((adId) => {
      const decon = deconRows.find((d) => d.ad_id === adId);
      const a = decon?.analysis as
        | { hook?: { description?: string }; tone?: string; cta?: string }
        | null;
      const metrics = byAdId.get(adId);
      return {
        ad_id: adId,
        account_id: decon?.account_id ?? null,
        hook: a?.hook?.description?.slice(0, 200) ?? null,
        tone: a?.tone ?? null,
        cta: a?.cta?.slice(0, 200) ?? null,
        metrics: metrics?.total ?? null,
        consistency_tier: metrics?.tier ?? null,
      };
    }),
    note: input.account_id
      ? null
      : "Pass account_id to include live metrics + consistency tier. Without it only creative deconstruction data is returned.",
  };
}

// ─── 13. get_deconstructions_batch ────────────────────────────────────
// Fetch multiple deconstructions in ONE tool call. Avoids the round-trip
// cost of calling get_ad_deconstruction N times for compilation flows.
export async function getDeconstructionsBatch(
  input: { ad_ids: string[]; include_full_transcript?: boolean },
  ctx: { supabase: SupabaseClient }
) {
  const adIds = Array.isArray(input.ad_ids)
    ? [...new Set(input.ad_ids.filter(Boolean))].slice(0, 20)
    : [];
  if (adIds.length === 0) return { error: "ad_ids is required" };

  const { data, error } = await ctx.supabase
    .from("ad_creative_analyses")
    .select(
      "id, ad_id, account_id, thumbnail_url, analysis, model, created_at"
    )
    .in("ad_id", adIds);
  if (error) throw new Error(error.message);

  const found = new Map<string, (typeof data)[number]>();
  for (const r of data ?? []) found.set(r.ad_id, r);

  return {
    requested: adIds.length,
    found: found.size,
    missing: adIds.filter((id) => !found.has(id)),
    deconstructions: adIds
      .filter((id) => found.has(id))
      .map((id) => {
        const r = found.get(id)!;
        const a = r.analysis as {
          transcript?: string;
          hook?: { description?: string; timestamp?: string };
          scenes?: Array<{ t: string; description: string }>;
          visual_style?: string;
          tone?: string;
          cta?: string;
          language?: string;
          duration_seconds?: number;
        };
        return {
          ad_id: r.ad_id,
          thumbnail_url: r.thumbnail_url,
          created_at: r.created_at,
          hook: a?.hook ?? null,
          tone: a?.tone ?? null,
          cta: a?.cta ?? null,
          visual_style: a?.visual_style ?? null,
          language: a?.language ?? null,
          duration_seconds: a?.duration_seconds ?? null,
          scenes: a?.scenes ?? [],
          transcript: input.include_full_transcript
            ? a?.transcript ?? null
            : typeof a?.transcript === "string"
              ? a.transcript.slice(0, 500) +
                (a.transcript.length > 500 ? "…" : "")
              : null,
        };
      }),
  };
}

// ─── 14. compile_winners ──────────────────────────────────────────────
// Specialist tool for the most common compilation task: "give me every
// ad matching criteria X, along with their deconstruction status."
//
// One tool call does: ad_performance + filter + deconstruction lookup +
// compact rows. Replaces the 5-7 round-trip pattern where the AI pulled
// performance, then fetched each deconstruction one at a time.
export async function compileWinners(
  input: {
    account_filter: string;
    date_preset?: string;
    max_cpp?: number;
    min_purchases?: number;
    min_roas?: number;
    min_spend?: number;
    limit?: number;
  },
  ctx: { fbToken: string; supabase: SupabaseClient }
) {
  if (!input.account_filter || input.account_filter === "ALL") {
    return {
      error:
        "compile_winners needs a specific account_filter (not 'ALL'). Call list_scaling_campaigns or list_ad_accounts first to narrow to one account.",
    };
  }
  const datePreset = coerceDatePreset(input.date_preset ?? "last_90d");
  const maxCpp = input.max_cpp ?? 280;
  const minPurchases = input.min_purchases ?? 10;
  const minRoas = input.min_roas ?? 0;
  const minSpend = input.min_spend ?? 0;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

  const perf = await fetchAdPerformance({
    token: ctx.fbToken,
    datePreset,
    accountFilter: input.account_filter,
  });

  const qualifying = perf.data
    .filter((a) => {
      if (a.purchases < minPurchases) return false;
      if (a.purchases > 0 && a.cpa > maxCpp) return false;
      if (a.roas < minRoas) return false;
      if (a.spend < minSpend) return false;
      return true;
    })
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, limit);

  // Bulk fetch matching deconstructions in ONE query.
  const ids = qualifying.map((a) => a.ad_id);
  const deconMap = new Map<string, unknown>();
  if (ids.length > 0) {
    const { data } = await ctx.supabase
      .from("ad_creative_analyses")
      .select("ad_id, analysis")
      .in("ad_id", ids);
    for (const r of data ?? []) deconMap.set(r.ad_id, r.analysis);
  }

  const rows = qualifying.map((a) => {
    const d = deconMap.get(a.ad_id) as
      | {
          hook?: { description?: string };
          tone?: string;
          cta?: string;
        }
      | undefined;
    return {
      ad_id: a.ad_id,
      ad: a.ad,
      campaign: a.campaign,
      adset: a.adset,
      account_id: a.account_id,
      spend: round(a.spend),
      purchases: a.purchases,
      cpp: round(a.cpa),
      roas: round(a.roas),
      ctr: round(a.ctr * 100, 2),
      has_deconstruction: Boolean(d),
      hook_preview: d?.hook?.description?.slice(0, 150) ?? null,
      tone_preview: d?.tone ?? null,
      cta_preview: d?.cta?.slice(0, 100) ?? null,
    };
  });

  const missingCount = rows.filter((r) => !r.has_deconstruction).length;

  return {
    date_preset: datePreset,
    account_filter: input.account_filter,
    criteria: { max_cpp: maxCpp, min_purchases: minPurchases, min_roas: minRoas, min_spend: minSpend },
    total_qualifying: rows.length,
    missing_deconstructions: missingCount,
    missing_ad_ids: rows.filter((r) => !r.has_deconstruction).map((r) => r.ad_id),
    totals: {
      spend: round(rows.reduce((s, r) => s + r.spend, 0)),
      purchases: rows.reduce((s, r) => s + r.purchases, 0),
      avg_cpp: rows.length
        ? round(
            rows.reduce((s, r) => s + r.cpp, 0) / rows.length
          )
        : 0,
      avg_roas: rows.length
        ? round(rows.reduce((s, r) => s + r.roas, 0) / rows.length)
        : 0,
    },
    winners: rows,
    note:
      missingCount > 0
        ? `${missingCount} winners haven't been deconstructed yet. You can call request_deconstruction(ad_id) to analyze them on-the-fly (30-90s each, max 10 per session), or use get_ad_deconstruction on specific ones you need.`
        : null,
  };
}
