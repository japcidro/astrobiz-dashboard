// Auto-deconstruction of script-sourced winning ads.
//
// Every 6 hours this cron scans all ad_drafts with a source_script_id AND an
// fb_ad_id, fetches their per-day insights from Meta, classifies each ad's
// consistency tier, and for any ad that has become a stable_winner (ROAS ≥ 5.0
// for ≥3 consecutive days) it triggers Gemini video analysis and fires an
// admin_alert to notify the CEO.
//
// Design notes:
// - Uses CRON_SECRET Bearer auth + service-role client, matching the existing
//   cron at /api/cron/deconstruct-top-ads.
// - Calls deconstructAdVideo() directly (not the HTTP endpoint) — avoids the
//   user-auth check on the route handler and cuts one hop of overhead.
// - Dedupes against ad_creative_analyses with the same 7-day TTL used
//   elsewhere in the platform.
// - Caps MAX_ANALYSES=3 per run. Gemini video analysis can eat ~3 minutes of
//   the 300s Fluid Compute budget per video; running the cron every 6 hours
//   gives us 4 passes/day × 3 ads = 12 winners/day capacity, more than enough
//   at current volume.
// - Alert dedup: 7 days per ad to avoid re-alerting on the same ad each run.

import { createServiceClient } from "@/lib/supabase/service";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";
import {
  fetchAdDailyInsights,
  classifyConsistency,
  DEFAULT_WINNER_THRESHOLDS,
} from "@/lib/facebook/insights-daily";
import { insertAlert } from "@/lib/alerts/insert";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ANALYSES = 3;
const SKIP_IF_ANALYZED_WITHIN_DAYS = 7;
const ALERT_DEDUP_HOURS = 24 * 7; // don't re-alert the same ad for a week
const INSIGHTS_CONCURRENCY = 4;

interface DraftRow {
  id: string;
  fb_ad_id: string;
  source_script_id: string;
  name: string;
}

interface ScriptMeta {
  id: string;
  store_name: string;
  angle_title: string;
}

interface AdContext {
  draft: DraftRow;
  script: ScriptMeta;
  account_id: string | null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();

  // 1. Load credentials
  const [{ data: fbTokenRow }, { data: geminiKeyRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "gemini_api_key")
      .single(),
  ]);

  const fbToken = (fbTokenRow?.value as string | undefined) ?? null;
  const geminiKey = (geminiKeyRow?.value as string | undefined) ?? null;

  if (!fbToken) {
    return Response.json(
      { error: "Facebook token not configured", analyzed: 0 },
      { status: 400 }
    );
  }
  if (!geminiKey) {
    return Response.json(
      { error: "Gemini API key not configured", analyzed: 0 },
      { status: 400 }
    );
  }

  // 2. Pull candidate ads: every draft with a source_script_id and a
  //    submitted fb_ad_id. Then join approved_scripts for title/store info.
  const { data: drafts, error: draftsErr } = await supabase
    .from("ad_drafts")
    .select("id, fb_ad_id, source_script_id, name")
    .not("source_script_id", "is", null)
    .not("fb_ad_id", "is", null);

  if (draftsErr) {
    return Response.json(
      { error: `Failed to load drafts: ${draftsErr.message}`, analyzed: 0 },
      { status: 500 }
    );
  }

  const draftRows = (drafts || []) as DraftRow[];
  if (draftRows.length === 0) {
    return Response.json({
      analyzed: 0,
      checked: 0,
      elapsed_seconds: 0,
      message: "No script-linked ads found.",
    });
  }

  const scriptIds = Array.from(new Set(draftRows.map((d) => d.source_script_id)));
  const { data: scripts, error: scriptsErr } = await supabase
    .from("approved_scripts")
    .select("id, store_name, angle_title")
    .in("id", scriptIds);

  if (scriptsErr) {
    return Response.json(
      { error: `Failed to load scripts: ${scriptsErr.message}`, analyzed: 0 },
      { status: 500 }
    );
  }

  const scriptById = new Map<string, ScriptMeta>();
  for (const s of (scripts || []) as ScriptMeta[]) {
    scriptById.set(s.id, s);
  }

  // 3. Skip ads that have already been deconstructed in the last 7 days.
  //    Fetching by ad_id is faster than one-by-one queries.
  const adIds = draftRows.map((d) => d.fb_ad_id);
  const skipBefore = new Date(
    Date.now() - SKIP_IF_ANALYZED_WITHIN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recent } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, account_id, created_at")
    .in("ad_id", adIds)
    .gte("created_at", skipBefore);
  const alreadyAnalyzed = new Set(
    (recent || []).map((r) => r.ad_id as string)
  );
  // Use existing account_id mapping for ads we HAVE seen before, so we don't
  // need to query Meta again for that field.
  const knownAccountByAd = new Map<string, string>();
  for (const r of recent || []) {
    if (r.ad_id && r.account_id) {
      knownAccountByAd.set(r.ad_id as string, r.account_id as string);
    }
  }

  const candidates: AdContext[] = [];
  for (const d of draftRows) {
    if (alreadyAnalyzed.has(d.fb_ad_id)) continue;
    const script = scriptById.get(d.source_script_id);
    if (!script) continue;
    candidates.push({
      draft: d,
      script,
      account_id: knownAccountByAd.get(d.fb_ad_id) ?? null,
    });
  }

  if (candidates.length === 0) {
    return Response.json({
      analyzed: 0,
      checked: draftRows.length,
      elapsed_seconds: parseFloat(((Date.now() - startedAt) / 1000).toFixed(1)),
      message: "All script-linked ads are either already deconstructed or have no recent activity.",
    });
  }

  // 4. Classify each candidate by fetching 14-day daily insights. Pre-filter
  //    to only stable_winners. Unknown account_id is skipped — the insights
  //    endpoint doesn't strictly need it but response-echoing gets confused.
  //    fetchAdDailyInsights works with empty account_id so we let it through.
  interface Classified {
    ctx: AdContext;
    tier: string;
    cpp: number;
    roas: number;
    purchases: number;
    max_consecutive: number;
  }
  const classified: Classified[] = [];

  for (let i = 0; i < candidates.length; i += INSIGHTS_CONCURRENCY) {
    const slice = candidates.slice(i, i + INSIGHTS_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (ctx) => {
        try {
          const metrics = await fetchAdDailyInsights(
            ctx.draft.fb_ad_id,
            ctx.account_id ?? "",
            fbToken,
            "last_14d"
          );
          const tier = classifyConsistency(metrics, DEFAULT_WINNER_THRESHOLDS);
          return {
            ctx,
            tier: tier.tier,
            cpp: metrics.total.cpp,
            roas: metrics.total.roas,
            purchases: metrics.total.purchases,
            max_consecutive: tier.max_consecutive,
          } as Classified;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r) classified.push(r);
  }

  const winners = classified
    .filter((c) => c.tier === "stable_winner")
    .sort((a, b) => b.max_consecutive - a.max_consecutive)
    .slice(0, MAX_ANALYSES);

  // 5. Deconstruct + upsert + alert for each winner
  const results: Array<{
    ad_id: string;
    ad_name: string;
    script_id: string;
    script_title: string;
    status:
      | "analyzed"
      | "alerted"
      | "skipped_no_video"
      | "error";
    detail?: string;
  }> = [];

  let analyzedCount = 0;
  let alertedCount = 0;

  for (const w of winners) {
    const { ctx } = w;
    try {
      const video = await resolveAdVideo(
        ctx.draft.fb_ad_id,
        fbToken,
        ctx.account_id ?? ""
      );
      if (!video.video_url) {
        results.push({
          ad_id: ctx.draft.fb_ad_id,
          ad_name: ctx.draft.name,
          script_id: ctx.script.id,
          script_title: ctx.script.angle_title,
          status: "skipped_no_video",
          detail: video.source_note,
        });
        continue;
      }

      const out = await deconstructAdVideo(video.video_url, geminiKey);
      const { data: upsertedRow, error: upsertErr } = await supabase
        .from("ad_creative_analyses")
        .upsert(
          {
            ad_id: ctx.draft.fb_ad_id,
            account_id: ctx.account_id ?? video.source_note ?? "unknown",
            creative_id: video.creative_id,
            video_id: video.video_id,
            video_url: null,
            thumbnail_url: video.thumbnail_url,
            analysis: out.analysis as unknown as Record<string, unknown>,
            analyzed_by: null,
            trigger_source: "auto_daily",
            model: out.model,
            tokens_used: out.tokens_used,
            cost_usd: null,
          },
          { onConflict: "ad_id" }
        )
        .select("id")
        .single();
      if (upsertErr) throw new Error(upsertErr.message);
      analyzedCount += 1;

      // Promote the source approved_script to validated_winner and backfill
      // the v2.0 classification fields from the freshly-deconstructed live
      // ad. The performance_status='pending' filter prevents overwriting a
      // status an admin set manually.
      const cls = out.analysis.classification;
      await supabase
        .from("approved_scripts")
        .update({
          performance_status: "validated_winner",
          performance_validated_at: new Date().toISOString(),
          performance_metrics: {
            roas: w.roas,
            cpp: w.cpp,
            purchases: w.purchases,
            max_consecutive: w.max_consecutive,
          },
          source_winner_ad_id: ctx.draft.fb_ad_id,
          source_winner_analysis_id: upsertedRow?.id ?? null,
          awareness_level: cls?.awareness_level ?? null,
          funnel_stage: cls?.funnel_stage ?? null,
          hook_framework: cls?.hook_framework ?? null,
          strategic_format: cls?.strategic_format ?? null,
          video_format: cls?.video_format ?? null,
        })
        .eq("id", ctx.script.id)
        .eq("performance_status", "pending");

      // Fire notification for the CEO
      const alertId = await insertAlert(supabase, {
        type: "script_winner_deconstructed",
        severity: "action",
        title: `Winner deconstructed: ${ctx.script.angle_title}`,
        body: `${ctx.draft.name} hit stable winner (${w.roas.toFixed(2)}x ROAS, ${w.max_consecutive}-day streak, ${w.purchases} purchases). Video analysis ready.`,
        resource_type: "ad",
        resource_id: ctx.draft.fb_ad_id,
        action_url: `/marketing/ai-generator?view=library&script=${ctx.script.id}`,
        payload: {
          ad_id: ctx.draft.fb_ad_id,
          script_id: ctx.script.id,
          script_title: ctx.script.angle_title,
          store: ctx.script.store_name,
          cpp: w.cpp,
          roas: w.roas,
          purchases: w.purchases,
          max_consecutive: w.max_consecutive,
        },
        dedup_hours: ALERT_DEDUP_HOURS,
      });
      if (alertId) alertedCount += 1;

      results.push({
        ad_id: ctx.draft.fb_ad_id,
        ad_name: ctx.draft.name,
        script_id: ctx.script.id,
        script_title: ctx.script.angle_title,
        status: alertId ? "alerted" : "analyzed",
      });
    } catch (err) {
      results.push({
        ad_id: ctx.draft.fb_ad_id,
        ad_name: ctx.draft.name,
        script_id: ctx.script.id,
        script_title: ctx.script.angle_title,
        status: "error",
        detail: err instanceof Error ? err.message : "deconstruction failed",
      });
    }
  }

  const elapsedSec = parseFloat(((Date.now() - startedAt) / 1000).toFixed(1));
  console.info(
    `[cron/auto-deconstruct-winners] candidates=${candidates.length} winners=${winners.length} analyzed=${analyzedCount} alerted=${alertedCount} elapsed=${elapsedSec}s`
  );

  return Response.json({
    checked: draftRows.length,
    candidates: candidates.length,
    winners: winners.length,
    analyzed: analyzedCount,
    alerted: alertedCount,
    elapsed_seconds: elapsedSec,
    results,
  });
}
