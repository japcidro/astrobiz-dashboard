import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  fbFetchWithLimits,
  RateLimitedError,
  getBlockedUntil,
} from "@/lib/facebook/rate-limit";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface AdRow {
  account: string;
  account_id: string;
  campaign: string;
  campaign_id: string;
  adset: string;
  adset_id: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  purchases: number;
  cpa: number;
  start_time: string | null;
}

type KillRule = "no_purchase" | "high_cpa";

interface AutopilotConfig {
  id: string;
  enabled: boolean;
  kill_no_purchase_spend_min: number;
  kill_high_cpa_max: number;
}

interface ActionInsert {
  run_id: string;
  action: "paused" | "error";
  ad_id: string;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  account_id?: string | null;
  rule_matched?: string | null;
  spend?: number | null;
  purchases?: number | null;
  cpa?: number | null;
  status: "ok" | "error";
  error_message?: string | null;
}

function evaluateKillRule(
  row: AdRow,
  config: AutopilotConfig
): KillRule | null {
  if (row.status !== "ACTIVE") return null;

  if (
    row.purchases === 0 &&
    row.spend >= config.kill_no_purchase_spend_min
  ) {
    return "no_purchase";
  }
  if (row.purchases >= 1 && row.cpa > config.kill_high_cpa_max) {
    return "high_cpa";
  }
  return null;
}

async function fbToggleStatus(
  entityId: string,
  newStatus: "ACTIVE" | "PAUSED",
  token: string,
  supabase: SupabaseClient
): Promise<void> {
  const res = await fbFetchWithLimits(
    `${FB_API_BASE}/${entityId}?${new URLSearchParams({
      access_token: token,
      status: newStatus,
    })}`,
    { method: "POST" },
    supabase
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `FB API error: ${res.status}`);
  }
}

// Narrow per-campaign data fetch — replaces the old /all-ads call that
// pulled 5,966 ads just to filter to the 1–3 watched campaigns. This way
// autopilot can run every 10 min without burning the FB rate budget.
//
// Per watched campaign: 2 FB calls (ads list + insights). With 3 watched
// campaigns at every 10 min = 864 read calls/day, well within FB limits.
async function fetchWatchedAdData(
  watched: Array<{ campaign_id: string; account_id: string }>,
  token: string,
  supabase: SupabaseClient
): Promise<AdRow[]> {
  const accountByCampaign = new Map<string, string>();
  for (const w of watched) {
    accountByCampaign.set(w.campaign_id, w.account_id);
  }

  type RawAd = {
    id: string;
    name?: string;
    effective_status?: string;
    adset?: { id?: string; name?: string };
    campaign?: { id?: string; name?: string };
  };
  type RawInsightsRow = {
    ad_id?: string;
    ad_name?: string;
    adset_id?: string;
    adset_name?: string;
    campaign_id?: string;
    campaign_name?: string;
    spend?: string;
    actions?: Array<{ action_type: string; value: string }>;
    cost_per_action_type?: Array<{ action_type: string; value: string }>;
  };

  const allAds: AdRow[] = [];

  // Limit parallelism so we don't fire 20+ requests at once if the user
  // ever scales up the watchlist.
  const PARALLEL = 5;
  for (let i = 0; i < watched.length; i += PARALLEL) {
    const slice = watched.slice(i, i + PARALLEL);
    await Promise.all(
      slice.map(async ({ campaign_id }) => {
        const accountId = accountByCampaign.get(campaign_id) ?? "";

        // 1. Ads + statuses + names
        const adsRes = await fbFetchWithLimits(
          `${FB_API_BASE}/${campaign_id}/ads?fields=id,name,effective_status,adset{id,name},campaign{id,name}&limit=500&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
          supabase
        );
        if (!adsRes.ok) return;
        const adsJson = (await adsRes.json()) as { data?: RawAd[] };
        const adsMap = new Map<string, AdRow>();
        for (const ad of adsJson.data || []) {
          adsMap.set(ad.id, {
            account: "",
            account_id: accountId,
            campaign: ad.campaign?.name ?? "",
            campaign_id: ad.campaign?.id ?? campaign_id,
            adset: ad.adset?.name ?? "",
            adset_id: ad.adset?.id ?? "",
            ad: ad.name ?? "",
            ad_id: ad.id,
            // effective_status reflects parent state — if campaign or
            // adset is paused, this is "CAMPAIGN_PAUSED" / "ADSET_PAUSED",
            // not "ACTIVE". So checking === "ACTIVE" is sufficient.
            status: ad.effective_status ?? "UNKNOWN",
            spend: 0,
            purchases: 0,
            cpa: 0,
            start_time: null,
          });
        }

        // 2. Today's insights for this campaign
        const insightsRes = await fbFetchWithLimits(
          `${FB_API_BASE}/${campaign_id}/insights?level=ad&date_preset=today&fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,actions,cost_per_action_type&limit=500&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
          supabase
        );
        if (insightsRes.ok) {
          const insightsJson = (await insightsRes.json()) as {
            data?: RawInsightsRow[];
          };
          for (const row of insightsJson.data || []) {
            if (!row.ad_id) continue;
            const ad = adsMap.get(row.ad_id);
            if (!ad) continue;

            const actions = row.actions ?? [];
            const costPer = row.cost_per_action_type ?? [];
            const getAct = (
              arr: Array<{ action_type: string; value: string }>,
              type: string
            ) => parseFloat(arr.find((a) => a.action_type === type)?.value || "0");

            ad.spend = parseFloat(row.spend || "0");
            ad.purchases =
              getAct(actions, "purchase") ||
              getAct(actions, "offsite_conversion.fb_pixel_purchase");
            ad.cpa =
              getAct(costPer, "purchase") ||
              getAct(costPer, "offsite_conversion.fb_pixel_purchase");
          }
        }

        for (const ad of adsMap.values()) allAds.push(ad);
      })
    );
  }

  return allAds;
}

export async function POST(request: Request) {
  return handleRun(request);
}

// Vercel crons hit cron paths with GET by default.
export async function GET(request: Request) {
  return handleRun(request);
}

async function handleRun(request: Request) {
  const authHeader = request.headers.get("authorization");
  const isCron =
    !!process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`;

  let triggeredBy: "cron" | "manual" = "cron";

  if (!isCron) {
    const employee = await getEmployee();
    if (!employee) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (employee.role !== "admin") {
      return Response.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    triggeredBy = "manual";
  }

  const supabase = createServiceClient();
  const runId = randomUUID();

  // 1. Load config
  const { data: config, error: configError } = await supabase
    .from("autopilot_config")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (configError || !config) {
    return Response.json(
      {
        error:
          configError?.message ||
          "Autopilot config missing — run autopilot-migration.sql",
      },
      { status: 500 }
    );
  }

  const cfg = config as AutopilotConfig;

  if (!cfg.enabled) {
    return Response.json({
      run_id: runId,
      triggered_by: triggeredBy,
      skipped: true,
      reason: "Autopilot is OFF",
    });
  }

  // 2. Load FB token
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  const token = tokenSetting.value as string;

  // 3. Load watchlist
  const { data: watchedRaw, error: watchError } = await supabase
    .from("autopilot_watched_campaigns")
    .select("campaign_id, account_id");

  if (watchError) {
    return Response.json({ error: watchError.message }, { status: 500 });
  }

  const watched = (watchedRaw || []) as Array<{
    campaign_id: string;
    account_id: string;
  }>;

  if (watched.length === 0) {
    return Response.json({
      run_id: runId,
      triggered_by: triggeredBy,
      skipped: true,
      reason: "No campaigns on watchlist",
    });
  }

  // 4. Preflight rate-limit check — skip the run if FB is blocking us.
  //    Pause latency takes a hit (next run = +10 min) but we don't make
  //    things worse by piling on more failed calls.
  const blockedUntil = await getBlockedUntil(supabase);
  if (blockedUntil) {
    return Response.json({
      run_id: runId,
      triggered_by: triggeredBy,
      skipped: true,
      reason: "FB rate-limited",
      blocked_until: blockedUntil.toISOString(),
    });
  }

  // 5. Narrow fetch — only the watched campaigns, not all 5,966 ads.
  let watchedRows: AdRow[];
  try {
    watchedRows = await fetchWatchedAdData(watched, token, supabase);
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return Response.json(
        {
          run_id: runId,
          triggered_by: triggeredBy,
          skipped: true,
          reason: "FB rate-limited mid-fetch",
          blocked_until: e.blockedUntil?.toISOString() ?? null,
        },
        { status: 503 }
      );
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to fetch ads" },
      { status: 500 }
    );
  }

  // 6. Determine kill candidates
  const actionLog: ActionInsert[] = [];
  const killCandidates: Array<{ row: AdRow; rule: KillRule }> = [];

  for (const row of watchedRows) {
    const rule = evaluateKillRule(row, cfg);
    if (!rule) continue;
    killCandidates.push({ row, rule });
  }

  // 7. Execute pauses (batched). On rate-limit mid-batch, log + continue
  //    so we don't lose audit trail for what was paused.
  const batchSize = 5;
  for (let i = 0; i < killCandidates.length; i += batchSize) {
    const batch = killCandidates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ row, rule }) => {
        try {
          await fbToggleStatus(row.ad_id, "PAUSED", token, supabase);
          actionLog.push({
            run_id: runId,
            action: "paused",
            ad_id: row.ad_id,
            ad_name: row.ad,
            adset_id: row.adset_id,
            adset_name: row.adset,
            campaign_id: row.campaign_id,
            campaign_name: row.campaign,
            account_id: row.account_id,
            rule_matched: rule,
            spend: row.spend,
            purchases: row.purchases,
            cpa: row.cpa,
            status: "ok",
          });
        } catch (e) {
          actionLog.push({
            run_id: runId,
            action: "error",
            ad_id: row.ad_id,
            ad_name: row.ad,
            adset_id: row.adset_id,
            adset_name: row.adset,
            campaign_id: row.campaign_id,
            campaign_name: row.campaign,
            account_id: row.account_id,
            rule_matched: rule,
            spend: row.spend,
            purchases: row.purchases,
            cpa: row.cpa,
            status: "error",
            error_message: e instanceof Error ? e.message : "unknown",
          });
        }
      })
    );
  }

  // 8. Persist audit log
  if (actionLog.length > 0) {
    await supabase.from("autopilot_actions").insert(actionLog);
  }

  const pausedCount = actionLog.filter(
    (a) => a.action === "paused" && a.status === "ok"
  ).length;
  const errorCount = actionLog.filter((a) => a.status === "error").length;

  return Response.json({
    run_id: runId,
    triggered_by: triggeredBy,
    watched_campaigns: watched.length,
    scanned_ads: watchedRows.length,
    paused: pausedCount,
    errors: errorCount,
  });
}
