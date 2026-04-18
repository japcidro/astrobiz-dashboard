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
  min_age_hours: number;
  max_pauses_per_run: number;
  auto_resume: boolean;
  resume_lookback_hours: number;
}

interface PastPause {
  id: string;
  ad_id: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  account_id: string | null;
}

interface ActionInsert {
  run_id: string;
  action: "paused" | "resumed" | "skipped" | "error";
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
  status: "ok" | "error" | "skipped";
  error_message?: string | null;
  paused_action_id?: string | null;
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

function adIsYoung(row: AdRow, minAgeHours: number): boolean {
  if (!row.start_time) return false;
  const ageMs = Date.now() - new Date(row.start_time).getTime();
  return ageMs < minAgeHours * 60 * 60 * 1000;
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
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const cronAuth = process.env.CRON_SECRET
    ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
    : undefined;

  let rows: AdRow[] = [];
  try {
    const adsRes = await fetch(
      `${baseUrl}/api/facebook/all-ads?date_preset=today&account=ALL&refresh=1`,
      {
        headers: cronAuth,
        cache: "no-store",
      }
    );
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

  // 5. Determine kill candidates
  const killLog: ActionInsert[] = [];
  const killCandidates: Array<{
    row: AdRow;
    rule: KillRule;
  }> = [];

  for (const row of watchedRows) {
    const rule = evaluateKillRule(row, cfg);
    if (!rule) continue;

    if (adIsYoung(row, cfg.min_age_hours)) {
      killLog.push({
        run_id: runId,
        action: "skipped",
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
        status: "skipped",
        error_message: `Ad younger than ${cfg.min_age_hours}h — skipping`,
      });
      continue;
    }

    killCandidates.push({ row, rule });
  }

  const toPause = killCandidates.slice(0, cfg.max_pauses_per_run);

  // 6. Execute pauses (batched)
  const batchSize = 5;
  for (let i = 0; i < toPause.length; i += batchSize) {
    const batch = toPause.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ row, rule }) => {
        try {
          await fbToggleStatus(row.ad_id, "PAUSED", token);
          killLog.push({
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
          killLog.push({
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

  // 7. Auto-resume — find ads Autopilot paused within lookback window
  //    that are still in PAUSED state but whose CURRENT stats no longer
  //    match any kill rule (classic FB-delay recovery).
  const resumeLog: ActionInsert[] = [];

  if (cfg.auto_resume) {
    const lookbackMs = cfg.resume_lookback_hours * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - lookbackMs).toISOString();

    const { data: pastRaw } = await supabase
      .from("autopilot_actions")
      .select(
        "id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, account_id"
      )
      .eq("action", "paused")
      .eq("status", "ok")
      .is("undone_at", null)
      .gte("created_at", cutoff);

    const past = (pastRaw || []) as PastPause[];

    // Build current-stats lookup
    const rowById = new Map<string, AdRow>();
    for (const r of rows) rowById.set(r.ad_id, r);

    // Track ad_ids we already un-paused this run (a single ad may have
    // multiple past pause entries; only resume once).
    const resumedIds = new Set<string>();
    // Track ad_ids we just paused so we don't immediately resume them.
    const justPausedIds = new Set(
      killLog.filter((a) => a.action === "paused").map((a) => a.ad_id)
    );

    for (const p of past) {
      if (resumedIds.has(p.ad_id)) continue;
      if (justPausedIds.has(p.ad_id)) continue;

      const currentRow = rowById.get(p.ad_id);
      if (!currentRow) continue;

      // Only resume if the CURRENT status is actually PAUSED (not DELETED
      // or ACCOUNT-level blocked, and not already ACTIVE).
      if (currentRow.status !== "PAUSED") continue;

      // Still matches a kill rule? Then don't resume.
      const stillKill = evaluateKillRule(
        { ...currentRow, status: "ACTIVE" },
        cfg
      );
      if (stillKill) continue;

      try {
        await fbToggleStatus(p.ad_id, "ACTIVE", token);
        resumedIds.add(p.ad_id);
        resumeLog.push({
          run_id: runId,
          action: "resumed",
          ad_id: p.ad_id,
          ad_name: currentRow.ad ?? p.ad_name,
          adset_id: p.adset_id,
          adset_name: p.adset_name,
          campaign_id: p.campaign_id,
          campaign_name: p.campaign_name,
          account_id: p.account_id,
          rule_matched: "recovered",
          spend: currentRow.spend,
          purchases: currentRow.purchases,
          cpa: currentRow.cpa,
          status: "ok",
          paused_action_id: p.id,
        });
      } catch (e) {
        resumeLog.push({
          run_id: runId,
          action: "error",
          ad_id: p.ad_id,
          ad_name: p.ad_name,
          adset_id: p.adset_id,
          adset_name: p.adset_name,
          campaign_id: p.campaign_id,
          campaign_name: p.campaign_name,
          account_id: p.account_id,
          rule_matched: "recovered",
          spend: currentRow.spend,
          purchases: currentRow.purchases,
          cpa: currentRow.cpa,
          status: "error",
          error_message: e instanceof Error ? e.message : "unknown",
          paused_action_id: p.id,
        });
      }
    }

    // Mark past pauses as undone when successfully resumed
    if (resumedIds.size > 0) {
      await supabase
        .from("autopilot_actions")
        .update({ undone_at: new Date().toISOString() })
        .eq("action", "paused")
        .in("ad_id", Array.from(resumedIds));
    }
  }

  // 8. Persist audit log
  const allLog = [...killLog, ...resumeLog];
  if (allLog.length > 0) {
    await supabase.from("autopilot_actions").insert(allLog);
  }

  const pausedCount = killLog.filter(
    (a) => a.action === "paused" && a.status === "ok"
  ).length;
  const skippedCount = killLog.filter(
    (a) => a.action === "skipped"
  ).length;
  const errorCount = allLog.filter((a) => a.status === "error").length;
  const resumedCount = resumeLog.filter(
    (a) => a.action === "resumed" && a.status === "ok"
  ).length;

  return Response.json({
    run_id: runId,
    triggered_by: triggeredBy,
    watched_campaigns: watchedSet.size,
    scanned_ads: watchedRows.length,
    paused: pausedCount,
    resumed: resumedCount,
    skipped_young: skippedCount,
    errors: errorCount,
  });
}
