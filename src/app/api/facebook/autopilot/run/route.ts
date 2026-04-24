import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { randomUUID } from "crypto";

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
  token: string
): Promise<void> {
  const res = await fetch(
    `${FB_API_BASE}/${entityId}?${new URLSearchParams({
      access_token: token,
      status: newStatus,
    })}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `FB API error: ${res.status}`
    );
  }
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
  const watchedSet = new Set(watched.map((w) => w.campaign_id));

  if (watchedSet.size === 0) {
    return Response.json({
      run_id: runId,
      triggered_by: triggeredBy,
      skipped: true,
      reason: "No campaigns on watchlist",
    });
  }

  // 4. Fetch current ad data via our own /all-ads endpoint.
  //    This reuses the same FB fetching + status/insights pipeline.
  //    Cron triggers pass CRON_SECRET bearer; manual UI triggers need
  //    the user's session cookie forwarded, otherwise /all-ads 401s.
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const forwardHeaders: Record<string, string> = {};
  if (isCron && process.env.CRON_SECRET) {
    forwardHeaders.Authorization = `Bearer ${process.env.CRON_SECRET}`;
  } else {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) forwardHeaders.Cookie = cookieHeader;
  }

  let rows: AdRow[] = [];
  try {
    // No ?refresh=1 — reuse the standard 30-min Supabase cache so the
    // hourly autopilot run doesn't burn extra FB calls when fresh data
    // already exists. The ads refresh cron populates the cache on its
    // own schedule.
    const adsRes = await fetch(
      `${baseUrl}/api/facebook/all-ads?date_preset=today&account=ALL`,
      {
        headers: forwardHeaders,
        cache: "no-store",
      }
    );
    // Content-type check — if we got HTML (Vercel error page, redirect),
    // surface that explicitly instead of letting res.json() blow up.
    const ct = adsRes.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error(
        `all-ads returned non-JSON (${adsRes.status}) — likely auth redirect. Set CRON_SECRET env var.`
      );
    }
    if (!adsRes.ok) {
      const err = await adsRes.json().catch(() => ({}));
      throw new Error(err.error || `all-ads failed: ${adsRes.status}`);
    }
    const payload = await adsRes.json();
    rows = (payload.data || []) as AdRow[];
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Failed to fetch ads",
      },
      { status: 500 }
    );
  }

  const watchedRows = rows.filter((r) => watchedSet.has(r.campaign_id));

  // 5. Determine kill candidates — every ACTIVE ad on the watchlist that
  //    trips a kill rule gets paused, no age gate, no per-run cap.
  const actionLog: ActionInsert[] = [];
  const killCandidates: Array<{
    row: AdRow;
    rule: KillRule;
  }> = [];

  for (const row of watchedRows) {
    const rule = evaluateKillRule(row, cfg);
    if (!rule) continue;
    killCandidates.push({ row, rule });
  }

  // 6. Execute pauses (batched)
  const batchSize = 5;
  for (let i = 0; i < killCandidates.length; i += batchSize) {
    const batch = killCandidates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ row, rule }) => {
        try {
          await fbToggleStatus(row.ad_id, "PAUSED", token);
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

  // 7. Persist audit log
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
    watched_campaigns: watchedSet.size,
    scanned_ads: watchedRows.length,
    paused: pausedCount,
    errors: errorCount,
  });
}
