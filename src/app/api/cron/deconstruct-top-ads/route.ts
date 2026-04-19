import { createServiceClient } from "@/lib/supabase/service";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";

export const dynamic = "force-dynamic";
// One analysis can take ~40s; Vercel caps at 300s even on Fluid Compute.
// We also enforce our own MAX_ANALYSES per run.
export const maxDuration = 300;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// How many ads to deconstruct per account per day.
const TOP_N_PER_ACCOUNT = 2;
// Hard cap total analyses per run, across all accounts, to bound cost.
// Lowered from 10 to 4: a single 200MB video can eat ~3 minutes of
// the 300s budget, so fewer but more reliable runs is better than
// timing out mid-batch.
const MAX_ANALYSES = 4;
// Only analyze ads with at least these metrics (filters out noise).
const MIN_SPEND = 500;
const MIN_PURCHASES = 1;
// Skip ads that were already analyzed within this window.
const SKIP_IF_ANALYZED_WITHIN_DAYS = 7;

interface FbAdInsight {
  ad_id: string;
  ad_name: string;
  spend: string;
  actions?: Array<{ action_type: string; value: string }>;
}

interface AccountRef {
  id: string;
  name: string;
}

function getPurchases(insight: FbAdInsight): number {
  const actions = insight.actions ?? [];
  return (
    parseFloat(
      actions.find((a) => a.action_type === "purchase")?.value ?? "0"
    ) ||
    parseFloat(
      actions.find(
        (a) => a.action_type === "offsite_conversion.fb_pixel_purchase"
      )?.value ?? "0"
    ) ||
    0
  );
}

async function fetchTopAds(
  accountId: string,
  token: string
): Promise<FbAdInsight[]> {
  const params = new URLSearchParams({
    access_token: token,
    level: "ad",
    date_preset: "last_7d",
    fields: "ad_id,ad_name,spend,actions",
    limit: "500",
  });
  const res = await fetch(
    `${FB_API_BASE}/${accountId}/insights?${params.toString()}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `FB insights ${res.status}: ${text.slice(0, 200)}`
    );
  }
  const json = await res.json();
  const rows = (json.data as FbAdInsight[]) ?? [];
  return rows
    .filter(
      (r) =>
        parseFloat(r.spend || "0") >= MIN_SPEND &&
        getPurchases(r) >= MIN_PURCHASES
    )
    .sort((a, b) => getPurchases(b) - getPurchases(a))
    .slice(0, TOP_N_PER_ACCOUNT);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Load creds
  const [{ data: fbTokenRow }, { data: geminiKeyRow }, { data: selectedRow }] =
    await Promise.all([
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
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "fb_selected_accounts")
        .single(),
    ]);

  const fbToken = (fbTokenRow?.value as string | undefined) ?? null;
  const geminiKey = (geminiKeyRow?.value as string | undefined) ?? null;

  if (!fbToken) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  if (!geminiKey) {
    return Response.json(
      { error: "Gemini API key not configured" },
      { status: 400 }
    );
  }

  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedRow?.value
      ? JSON.parse(selectedRow.value as string)
      : [];
  } catch {
    selectedAccountIds = [];
  }

  // Discover accounts
  const accountsRes = await fetch(
    `${FB_API_BASE}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(fbToken)}`,
    { cache: "no-store" }
  );
  if (!accountsRes.ok) {
    const text = await accountsRes.text();
    return Response.json(
      { error: `FB accounts fetch failed: ${text.slice(0, 200)}` },
      { status: 502 }
    );
  }
  const accountsJson = await accountsRes.json();
  const allAccounts: Array<AccountRef & { account_status: number }> =
    (accountsJson.data as Array<AccountRef & { account_status: number }>) ?? [];

  const accounts = allAccounts.filter((a) => {
    if (a.account_status !== 1) return false;
    if (selectedAccountIds.length === 0) return true;
    return selectedAccountIds.includes(a.id);
  });

  // Recently analyzed ad_ids (to skip)
  const skipBefore = new Date(
    Date.now() - SKIP_IF_ANALYZED_WITHIN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recent } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id")
    .gte("created_at", skipBefore);
  const recentSet = new Set(
    (recent ?? []).map((r) => r.ad_id as string)
  );

  const results: Array<{
    account: string;
    ad_id: string;
    ad_name: string;
    status: "analyzed" | "skipped_recent" | "skipped_no_video" | "error";
    detail?: string;
  }> = [];

  const startedAt = Date.now();
  let analyzedCount = 0;

  for (const acct of accounts) {
    if (analyzedCount >= MAX_ANALYSES) break;

    let topAds: FbAdInsight[];
    try {
      topAds = await fetchTopAds(acct.id, fbToken);
    } catch (err) {
      results.push({
        account: acct.name,
        ad_id: "",
        ad_name: "",
        status: "error",
        detail: err instanceof Error ? err.message : "fetch failed",
      });
      continue;
    }

    for (const ad of topAds) {
      if (analyzedCount >= MAX_ANALYSES) break;
      if (recentSet.has(ad.ad_id)) {
        results.push({
          account: acct.name,
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          status: "skipped_recent",
        });
        continue;
      }

      try {
        const video = await resolveAdVideo(ad.ad_id, fbToken);
        if (!video.video_url) {
          results.push({
            account: acct.name,
            ad_id: ad.ad_id,
            ad_name: ad.ad_name,
            status: "skipped_no_video",
            detail: video.source_note,
          });
          continue;
        }
        const out = await deconstructAdVideo(video.video_url, geminiKey);
        const { error: upsertErr } = await supabase
          .from("ad_creative_analyses")
          .upsert(
            {
              ad_id: ad.ad_id,
              account_id: acct.id,
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
          );
        if (upsertErr) throw new Error(upsertErr.message);
        analyzedCount += 1;
        results.push({
          account: acct.name,
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          status: "analyzed",
        });
      } catch (err) {
        results.push({
          account: acct.name,
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          status: "error",
          detail: err instanceof Error ? err.message : "analysis failed",
        });
      }
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.info(
    `[cron/deconstruct-top-ads] analyzed=${analyzedCount} accounts=${accounts.length} elapsed=${elapsedSec}s`
  );

  return Response.json({
    analyzed: analyzedCount,
    accounts: accounts.length,
    elapsed_seconds: parseFloat(elapsedSec),
    results,
  });
}
