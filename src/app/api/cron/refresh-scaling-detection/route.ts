import { createServiceClient } from "@/lib/supabase/service";
import {
  fbFetchWithLimits,
  RateLimitedError,
  getBlockedUntil,
} from "@/lib/facebook/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const BATCH_SIZE = 50;

// Refreshes scaling_detection_cache so /api/marketing/scaling/detect can
// serve purely from Supabase. Runs every 30 min via Vercel cron.
//
// Strategy (delta-aware to keep FB call count low):
//   1. Walk scaling-campaign ads → build {creative_id → scaled_ad_id} map
//      per scaling campaign (3–5 FB calls + paging).
//   2. Pull the list of live ad_ids + account/campaign_id from the
//      cached_api_data "ads:today:ALL" blob. NO new FB call.
//   3. Query scaling_detection_cache for ad_ids we've seen before and
//      that aren't stale.
//   4. Fetch creative_id + campaign_id ONLY for new/stale ad_ids, in
//      batches of 50.
//   5. Upsert results for all observed ads (since scaling map may have
//      changed, re-match every ad).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();

  // Preflight: if FB told us we're blocked, skip this run entirely.
  const blockedUntil = await getBlockedUntil(supabase);
  if (blockedUntil) {
    return Response.json({
      skipped: true,
      reason: "FB rate-limited",
      blocked_until: blockedUntil.toISOString(),
    });
  }

  // --- 1. Load FB token + scaling campaigns -----------------------------
  const [{ data: tokenRow }, { data: scalingRows }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase.from("store_scaling_campaigns").select("*"),
  ]);
  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "FB token not configured" },
      { status: 400 }
    );
  }

  const scalingCampaigns =
    (scalingRows as
      | Array<{
          store_name: string;
          account_id: string;
          campaign_id: string;
          campaign_name: string;
        }>
      | null) ?? [];

  if (scalingCampaigns.length === 0) {
    return Response.json({
      skipped: true,
      reason: "No scaling campaigns configured",
      duration_ms: Date.now() - startTime,
    });
  }

  // --- 2. Walk each scaling campaign's ads → {creative_id → scaled_ad_id}
  const scalingCreativeMap = new Map<
    string,
    Map<string, string>
  >();
  let fbCalls = 0;
  try {
    await Promise.all(
      scalingCampaigns.map(async (sc) => {
        const creativeIds = new Map<string, string>();
        let next:
          | string
          | null = `${FB_API_BASE}/${sc.campaign_id}/ads?fields=id,creative{id}&limit=200&access_token=${encodeURIComponent(token)}`;
        while (next) {
          fbCalls++;
          const res = await fbFetchWithLimits(
            next,
            { cache: "no-store" },
            supabase
          );
          if (!res.ok) break;
          const json = (await res.json()) as {
            data?: Array<{ id: string; creative?: { id?: string } }>;
            paging?: { next?: string };
          };
          for (const ad of json.data ?? []) {
            const cid = ad.creative?.id;
            if (cid && !creativeIds.has(cid)) {
              creativeIds.set(cid, ad.id);
            }
          }
          next = json.paging?.next ?? null;
        }
        scalingCreativeMap.set(sc.campaign_id, creativeIds);
      })
    );
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return Response.json(
        {
          rate_limited: true,
          blocked_until: e.blockedUntil?.toISOString() ?? null,
          message: e.message,
          fb_calls: fbCalls,
        },
        { status: 503 }
      );
    }
    throw e;
  }

  // --- 3. Pull live ad list from cached ads blob (NO FB call) ----------
  const { data: adsCache } = await supabase
    .from("cached_api_data")
    .select("response_data, refreshed_at")
    .like("cache_key", "ads_v2:%account=ALL%date_preset=today%")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type CachedAdRow = {
    ad_id?: string;
    campaign_id?: string;
    account_id?: string;
  };
  const cachedRows =
    (adsCache?.response_data as { data?: CachedAdRow[] } | null)?.data ?? [];

  if (cachedRows.length === 0) {
    return Response.json({
      skipped: true,
      reason: "No ads cache yet — wait for /api/cron/refresh-data to populate",
      scaling_campaigns: scalingCampaigns.length,
      fb_calls: fbCalls,
    });
  }

  // --- 4. Figure out which ads need a creative_id fetch ----------------
  //    Already-cached, refreshed within 24h → skip.
  const allAdIds = Array.from(
    new Set(
      cachedRows
        .map((r) => r.ad_id)
        .filter((x): x is string => typeof x === "string" && !!x)
    )
  );

  const { data: cachedEntries } = await supabase
    .from("scaling_detection_cache")
    .select("fb_ad_id, creative_id, campaign_id, account_id, refreshed_at")
    .in("fb_ad_id", allAdIds);

  const STALE_MS = 24 * 60 * 60 * 1000;
  const existing = new Map<
    string,
    {
      creative_id: string | null;
      campaign_id: string | null;
      account_id: string | null;
      refreshed_at: string;
    }
  >();
  for (const row of cachedEntries || []) {
    existing.set(row.fb_ad_id, {
      creative_id: row.creative_id ?? null,
      campaign_id: row.campaign_id ?? null,
      account_id: row.account_id ?? null,
      refreshed_at: row.refreshed_at,
    });
  }

  const needsFetch: string[] = [];
  for (const adId of allAdIds) {
    const cached = existing.get(adId);
    if (
      !cached ||
      Date.now() - new Date(cached.refreshed_at).getTime() > STALE_MS
    ) {
      needsFetch.push(adId);
    }
  }

  // --- 5. Fetch creative_id + campaign_id for new/stale ads only -------
  const creativeByAd = new Map<
    string,
    { creative_id: string | null; campaign_id: string | null }
  >();
  // Seed from existing cache first
  for (const [adId, info] of existing.entries()) {
    creativeByAd.set(adId, {
      creative_id: info.creative_id,
      campaign_id: info.campaign_id,
    });
  }

  try {
    for (let i = 0; i < needsFetch.length; i += BATCH_SIZE) {
      const chunk = needsFetch.slice(i, i + BATCH_SIZE);
      const url = `${FB_API_BASE}/?ids=${chunk.join(",")}&fields=creative{id},campaign{id}&access_token=${encodeURIComponent(token)}`;
      fbCalls++;
      const res = await fbFetchWithLimits(
        url,
        { cache: "no-store" },
        supabase
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<
        string,
        { creative?: { id?: string }; campaign?: { id?: string } }
      >;
      for (const [id, node] of Object.entries(json)) {
        creativeByAd.set(id, {
          creative_id: node?.creative?.id ?? null,
          campaign_id: node?.campaign?.id ?? null,
        });
      }
    }
  } catch (e) {
    if (e instanceof RateLimitedError) {
      // Partial results — still upsert what we have before returning
    } else {
      throw e;
    }
  }

  // --- 6. Compute scaling info per ad + upsert -------------------------
  const accountByAd = new Map<string, string>();
  for (const r of cachedRows) {
    if (r.ad_id && r.account_id) accountByAd.set(r.ad_id, r.account_id);
  }

  const upsertRows: Array<{
    fb_ad_id: string;
    creative_id: string | null;
    campaign_id: string | null;
    account_id: string | null;
    in_scaling: boolean;
    scaled_ad_id: string | null;
    scaled_in_campaign: string | null;
    scaled_in_store: string | null;
    self_is_scaling: boolean;
    refreshed_at: string;
  }> = [];

  const now = new Date().toISOString();
  for (const adId of allAdIds) {
    const info = creativeByAd.get(adId) ?? {
      creative_id: null,
      campaign_id: null,
    };
    const selfScaling = scalingCampaigns.some(
      (sc) => sc.campaign_id === info.campaign_id
    );

    let match: { sc_campaign: string; scaled_ad_id: string } | null = null;
    if (info.creative_id) {
      for (const sc of scalingCampaigns) {
        const map = scalingCreativeMap.get(sc.campaign_id);
        if (!map) continue;
        const scaledAdId = map.get(info.creative_id);
        if (scaledAdId && sc.campaign_id !== info.campaign_id) {
          match = { sc_campaign: sc.campaign_id, scaled_ad_id: scaledAdId };
          break;
        }
      }
    }

    const scMatch = match
      ? scalingCampaigns.find((s) => s.campaign_id === match!.sc_campaign) ??
        null
      : null;

    upsertRows.push({
      fb_ad_id: adId,
      creative_id: info.creative_id,
      campaign_id: info.campaign_id,
      account_id: accountByAd.get(adId) ?? null,
      in_scaling: !!match,
      scaled_ad_id: match?.scaled_ad_id ?? null,
      scaled_in_campaign: match?.sc_campaign ?? null,
      scaled_in_store: scMatch?.store_name ?? null,
      self_is_scaling: selfScaling,
      refreshed_at: now,
    });
  }

  // Upsert in chunks — Supabase has a row-count limit per call (~1000).
  const UPSERT_CHUNK = 500;
  for (let i = 0; i < upsertRows.length; i += UPSERT_CHUNK) {
    const slice = upsertRows.slice(i, i + UPSERT_CHUNK);
    await supabase
      .from("scaling_detection_cache")
      .upsert(slice, { onConflict: "fb_ad_id" });
  }

  await supabase
    .from("fb_refresh_state")
    .upsert(
      {
        scope: "scaling_detection",
        refreshed_at: now,
        triggered_by: "cron",
        status: "ok",
        message: `Refreshed ${upsertRows.length} ads, ${fbCalls} FB calls`,
      },
      { onConflict: "scope" }
    );

  return Response.json({
    success: true,
    ads_processed: upsertRows.length,
    new_fetches: needsFetch.length,
    scaling_campaigns: scalingCampaigns.length,
    fb_calls: fbCalls,
    duration_ms: Date.now() - startTime,
  });
}
