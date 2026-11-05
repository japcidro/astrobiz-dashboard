import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { getCachedResponse, setCachedResponse } from "@/lib/data-cache";
import { getBlockedUntil } from "@/lib/facebook/rate-limit";
import { isNurseryCampaign } from "@/lib/facebook/nursery";
import { matchAdToStore } from "@/lib/profit/store-matching";
import {
  DEFAULT_WINDOW_DAYS,
  WINDOW_OPTIONS,
  attributeMarketer,
  computeMetrics,
  launchDateOf,
  phtDate,
  phtToday,
  reviewStateOf,
  type AdFix,
  type LaunchedAd,
  type LaunchedCreativesResponse,
} from "@/lib/marketing/launched-creatives";
import { loadDailySeries, syncDailyInsights } from "@/lib/marketing/ad-daily-sync";
import { loadRejections, recordRejections } from "@/lib/marketing/ad-rejections";

export const dynamic = "force-dynamic";
// Several ad accounts paginated in parallel, then the daily insights sync.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_ACCOUNT = 20;
/** The ad list is re-read from Facebook at most this often; Refresh forces it. */
const LIST_TTL_MS = 15 * 60 * 1000;
/** A list this old is still shown (flagged) when Facebook cannot be read. */
const STALE_MAX_MS = 24 * 60 * 60 * 1000;

interface RawCreative {
  id?: string;
  video_id?: string;
  thumbnail_url?: string;
  image_url?: string;
  effective_object_story_id?: string;
  object_story_spec?: {
    video_data?: { video_id?: string };
    link_data?: { picture?: string };
  };
}
interface RawAd {
  id: string;
  name: string;
  created_time?: string;
  effective_status?: string;
  creative?: RawCreative;
  adset?: { id?: string; name?: string; start_time?: string };
  campaign?: { id?: string; name?: string };
}

/** What the list cache stores per ad: Facebook's own facts, nothing computed. */
interface ListedAd {
  ad_id: string;
  account_id: string;
  account_name: string;
  ad_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_type: "video" | "image";
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  preview_url: string | null;
  created_time: string | null;
  start_time: string | null;
  effective_status: string | null;
}

interface ListPayload {
  ads: ListedAd[];
  warnings: string[];
}

async function fetchAccountAds(accountId: string, token: string, sinceUnix: number): Promise<RawAd[]> {
  const fields =
    "id,name,created_time,effective_status," +
    "creative{id,video_id,thumbnail_url,image_url,effective_object_story_id,object_story_spec}," +
    "adset{id,name,start_time},campaign{id,name}";
  const filtering = JSON.stringify([
    { field: "ad.created_time", operator: "GREATER_THAN", value: sinceUnix },
  ]);
  let url =
    `${FB_API_BASE}/${accountId}/ads?` +
    new URLSearchParams({ access_token: token, fields, filtering, limit: String(PAGE_SIZE) }).toString();
  const out: RawAd[] = [];
  for (let page = 0; url && page < MAX_PAGES_PER_ACCOUNT; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      const json = await res.json();
      if (!res.ok) {
        throw new Error((json as { error?: { message?: string } }).error?.message || `FB ${res.status}`);
      }
      out.push(...((json.data ?? []) as RawAd[]));
      url = (json.paging?.next as string) ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

function toListed(ad: RawAd, account: { id: string; name: string }): ListedAd {
  const creative = ad.creative ?? {};
  const oss = creative.object_story_spec ?? {};
  const videoId = oss.video_data?.video_id ?? creative.video_id ?? null;
  const storyId = creative.effective_object_story_id;
  return {
    ad_id: ad.id,
    account_id: account.id,
    account_name: account.name,
    ad_name: ad.name,
    campaign_id: ad.campaign?.id ?? null,
    campaign_name: ad.campaign?.name ?? null,
    adset_id: ad.adset?.id ?? null,
    adset_name: ad.adset?.name ?? null,
    creative_type: videoId ? "video" : "image",
    thumbnail_url: creative.thumbnail_url ?? null,
    image_url: creative.image_url ?? oss.link_data?.picture ?? null,
    video_id: videoId,
    preview_url: storyId ? `https://www.facebook.com/${storyId.replace("_", "/posts/")}` : null,
    created_time: ad.created_time ?? null,
    start_time: ad.adset?.start_time ?? null,
    effective_status: ad.effective_status ?? null,
  };
}

async function listFromFacebook(
  token: string,
  accounts: { id: string; name: string }[],
  sinceMs: number
): Promise<ListPayload> {
  const warnings: string[] = [];
  const sinceUnix = Math.floor(sinceMs / 1000);
  const perAccount = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const raw = await fetchAccountAds(acc.id, token, sinceUnix);
        return raw
          .filter((r) => !r.created_time || new Date(r.created_time).getTime() >= sinceMs)
          .map((r) => toListed(r, acc));
      } catch (e) {
        warnings.push(`${acc.name}: ${e instanceof Error ? e.message : "could not list ads"}`);
        return [] as ListedAd[];
      }
    })
  );
  const ads = perAccount.flat();
  ads.sort((a, b) => (b.created_time ?? "").localeCompare(a.created_time ?? ""));
  return { ads, warnings };
}

// GET /api/marketing/launched-creatives?days=30&refresh=1
//
// Every ad created in the last `days` across the selected ad accounts, each
// with its launch day, first-3/first-7-day and lifetime results, Meta's
// review status and stored rejection reason, and the Fix Rejections swap
// if one happened. Facebook is read for the list at most every 15 minutes
// (Refresh forces it); the daily numbers come from fb_ad_daily_insights,
// topped up from Facebook on the same cadence.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get("days") || String(DEFAULT_WINDOW_DAYS), 10);
  const days = (WINDOW_OPTIONS as readonly number[]).includes(requested) ? requested : DEFAULT_WINDOW_DAYS;
  const forceRefresh = searchParams.get("refresh") === "1";

  const supabase = await createClient();
  const db = createServiceClient();

  const [{ data: tokenSetting }, { data: selectedSetting }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "fb_access_token").single(),
    supabase.from("app_settings").select("value").eq("key", "fb_selected_accounts").single(),
  ]);
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured. Go to Settings." }, { status: 400 });
  }
  const token = tokenSetting.value as string;
  let selectedIds: string[] = [];
  try {
    selectedIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    selectedIds = [];
  }

  const now = new Date();
  const sinceMs = now.getTime() - days * 86400000;
  const cacheKey = `launched_ads_v1:days=${days}`;
  const warnings: string[] = [];

  // 1. The ad list: cache, else Facebook, else a stale cache.
  let list: ListPayload | null = null;
  let refreshedAt = now.toISOString();
  let fromCache = false;
  if (!forceRefresh) {
    const cached = await getCachedResponse<ListPayload>(db, cacheKey, LIST_TTL_MS).catch(() => null);
    if (cached) {
      list = cached.data;
      refreshedAt = cached.refreshed_at;
      fromCache = true;
    }
  }

  if (!list) {
    const blockedUntil = await getBlockedUntil(db).catch(() => null);
    if (blockedUntil) {
      warnings.push(`Facebook is rate-limiting us until ${blockedUntil.toISOString()}; showing the last list.`);
    } else {
      let accounts: { id: string; name: string }[] = [];
      try {
        const res = await fetch(
          `${FB_API_BASE}/me/adaccounts?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { data?: { id: string; name: string }[]; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message || "Couldn't load ad accounts");
        accounts = json.data ?? [];
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "Couldn't load ad accounts");
      }
      if (selectedIds.length > 0) accounts = accounts.filter((a) => selectedIds.includes(a.id));
      if (accounts.length > 0) {
        const fresh = await listFromFacebook(token, accounts, sinceMs);
        warnings.push(...fresh.warnings);
        // A list with every account failed is not worth caching.
        if (fresh.ads.length > 0 || fresh.warnings.length === 0) {
          list = fresh;
          refreshedAt = now.toISOString();
          void setCachedResponse(db, "launched_ads", cacheKey, fresh).catch(() => {});
        }
      }
    }
    if (!list) {
      const stale = await getCachedResponse<ListPayload>(db, cacheKey, STALE_MAX_MS).catch(() => null);
      if (stale) {
        list = stale.data;
        refreshedAt = stale.refreshed_at;
        fromCache = true;
      } else {
        return Response.json(
          { error: warnings[0] ?? "Couldn't read the ad accounts from Facebook." },
          { status: 502 }
        );
      }
    }
  }

  const ads = list.ads;
  const adIds = ads.map((a) => a.ad_id);

  // 2. Launch days, then top up the daily numbers and the rejection log.
  //    Both only when the list itself was just re-read, so a plain page
  //    view costs no Facebook calls.
  const launch = new Map(ads.map((a) => [a.ad_id, launchDateOf(a.created_time, a.start_time, now)]));
  if (!fromCache) {
    const sync = await syncDailyInsights(
      db,
      token,
      ads.map((a) => ({
        ad_id: a.ad_id,
        account_id: a.account_id,
        launch_date: launch.get(a.ad_id)?.launch_date ?? null,
      })),
      now
    );
    if (sync.rate_limited) warnings.push("Facebook rate limit hit while reading daily results; numbers may lag.");
    else warnings.push(...sync.errors.slice(0, 3));
    await recordRejections(
      db,
      token,
      ads.map((a) => ({ ad_id: a.ad_id, account_id: a.account_id, effective_status: a.effective_status }))
    ).catch(() => {});
  }

  // 3. Stored facts: daily series, rejections, Fix Rejections swaps.
  const [series, rejections, fixes] = await Promise.all([
    loadDailySeries(db, adIds).catch((e: Error) => {
      warnings.push(`Daily results unavailable: ${e.message}`);
      return new Map();
    }),
    loadRejections(db, adIds),
    loadFixes(db, adIds),
  ]);

  const today = phtToday(now);
  const data: LaunchedAd[] = ads.map((a) => {
    const l = launch.get(a.ad_id) ?? { launch_date: null, scheduled: false };
    const fix = fixes.get(a.ad_id) ?? null;
    const metrics = computeMetrics(
      series.get(a.ad_id) ?? [],
      l.launch_date,
      fix ? phtDate(fix.fixed_at) : null,
      today
    );
    return {
      ad_id: a.ad_id,
      account_id: a.account_id,
      account_name: a.account_name,
      ad_name: a.ad_name,
      campaign_id: a.campaign_id,
      campaign_name: a.campaign_name,
      adset_id: a.adset_id,
      adset_name: a.adset_name,
      store_name:
        matchAdToStore(`${a.campaign_name ?? ""} ${a.ad_name}`, a.adset_name ?? "", a.account_name) || null,
      marketer_name: attributeMarketer(a.ad_name).name,
      is_nursery: isNurseryCampaign(a.campaign_name),
      creative_type: a.creative_type,
      thumbnail_url: a.thumbnail_url,
      image_url: a.image_url,
      video_id: a.video_id,
      preview_url: a.preview_url,
      created_time: a.created_time,
      start_time: a.start_time,
      effective_status: a.effective_status,
      review_state: reviewStateOf(a.effective_status, l.scheduled),
      launch_date: l.launch_date,
      ...metrics,
      rejection: rejections.get(a.ad_id) ?? null,
      fix,
    };
  });

  const body: LaunchedCreativesResponse = {
    data,
    window_days: days,
    refreshed_at: refreshedAt,
    from_cache: fromCache,
    warnings,
  };
  return Response.json(body);
}

/** The latest successful Fix Rejections swap per ad. */
async function loadFixes(
  db: ReturnType<typeof createServiceClient>,
  adIds: string[]
): Promise<Map<string, AdFix>> {
  const out = new Map<string, AdFix>();
  for (let i = 0; i < adIds.length; i += 200) {
    const { data } = await db
      .from("fix_rejection_actions")
      .select(
        "ad_id, status, created_at, safe_image:fix_rejection_safe_images!safe_image_id(name), actor:employees!actor_id(full_name)"
      )
      .in("ad_id", adIds.slice(i, i + 200))
      .in("status", ["success", "partial"])
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const id = r.ad_id as string;
      if (out.has(id)) continue; // newest first; keep the latest swap
      out.set(id, {
        fixed_at: r.created_at as string,
        status: r.status as string,
        safe_image_name: ((r.safe_image as { name?: string } | null)?.name as string) ?? null,
        by_name: ((r.actor as { full_name?: string } | null)?.full_name as string) ?? null,
      });
    }
  }
  return out;
}
