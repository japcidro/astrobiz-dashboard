import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "@/lib/data-cache";
import type { DatePreset } from "@/lib/facebook/types";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Structure cache for campaigns/adsets/ads statuses — rarely changes
const structureCache = new Map<string, { data: unknown; timestamp: number }>();
const STRUCTURE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for structure

const INSIGHTS_FIELDS = [
  "account_name",
  "account_id",
  "campaign_name",
  "campaign_id",
  "adset_name",
  "adset_id",
  "ad_name",
  "ad_id",
  "spend",
  "reach",
  "impressions",
  "actions",
  "action_values",
  "cost_per_action_type",
  "ctr",
].join(",");

const ACCOUNT_STATUS_MAP: Record<number, string> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
};

async function fbFetchAll<T>(
  url: string,
  token?: string,
  params?: Record<string, string>,
  timeoutMs = 7000
): Promise<T[]> {
  const allData: T[] = [];
  let fetchUrl: string;

  if (token && params) {
    fetchUrl = `${FB_API_BASE}${url}?${new URLSearchParams({ access_token: token, ...params })}`;
  } else {
    // url is already a full URL (pagination)
    fetchUrl = url;
  }

  while (fetchUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(fetchUrl, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `FB API error: ${res.status}`);
    }
    const json = await res.json();
    allData.push(...(json.data || []));
    fetchUrl = json.paging?.next || "";
  }

  return allData;
}

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  status_label: string;
  is_active: boolean;
}

export async function GET(request: Request) {
  // Allow cron jobs to bypass auth using CRON_SECRET
  const isCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  let employeeRole = "admin";
  if (!isCron) {
    const employee = await getEmployee();
    if (!employee) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["admin", "marketing"].includes(employee.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    employeeRole = employee.role;
  }

  const { searchParams } = new URL(request.url);
  const datePreset = (searchParams.get("date_preset") || "today") as DatePreset;
  const accountFilter = searchParams.get("account") || "ALL";
  const forceRefresh = searchParams.get("refresh") === "1";

  // Optional explicit date range (YYYY-MM-DD PHT). When both present, we pass
  // time_range to FB insights instead of date_preset so briefings can backfill
  // arbitrary historical dates (e.g. two Mondays ago) that no preset covers.
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const useTimeRange = Boolean(dateFrom && dateTo);
  const insightsDateParam: { date_preset: string } | { time_range: string } = useTimeRange
    ? { time_range: JSON.stringify({ since: dateFrom, until: dateTo }) }
    : { date_preset: datePreset };

  // Cron invocations have no user session — use service client so
  // RLS on app_settings doesn't silently return empty FB token.
  const supabase = isCron ? createServiceClient() : await createClient();

  // Check Supabase cache first
  const cacheKey = buildCacheKey("ads", {
    date_preset: useTimeRange ? `range:${dateFrom}:${dateTo}` : datePreset,
    account: accountFilter,
  });

  if (!forceRefresh) {
    const cached = await getCachedResponse(supabase, cacheKey);
    if (cached) {
      return Response.json({
        ...(cached.data as Record<string, unknown>),
        role: employeeRole,
        refreshed_at: cached.refreshed_at,
        from_cache: true,
      });
    }
  }

  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured. Go to Settings." },
      { status: 400 }
    );
  }

  const token = tokenSetting.value;

  // Get selected accounts filter from settings
  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();

  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    selectedAccountIds = [];
  }

  try {
    // Step 1: Fetch all ad accounts from Business Manager
    const accountsRaw = await fbFetchAll<{
      id: string;
      name: string;
      account_id: string;
      account_status: number;
    }>(`/me/adaccounts`, token, {
      fields: "id,name,account_id,account_status",
      limit: "100",
    });

    const allAccounts: AccountInfo[] = accountsRaw.map((a) => ({
      ...a,
      status_label: ACCOUNT_STATUS_MAP[a.account_status] || "UNKNOWN",
      is_active: a.account_status === 1,
    }));

    // Apply settings-level filter (only show selected accounts)
    const accounts =
      selectedAccountIds.length > 0
        ? allAccounts.filter((a) => selectedAccountIds.includes(a.id))
        : allAccounts;

    // Determine which accounts to query (UI-level account dropdown filter)
    const targetAccounts =
      accountFilter === "ALL"
        ? accounts
        : accounts.filter((a) => a.id === accountFilter || a.account_id === accountFilter);

    if (targetAccounts.length === 0) {
      return Response.json({
        data: [],
        totals: { count: 0, spend: 0, link_clicks: 0, purchases: 0, add_to_cart: 0, reach: 0, impressions: 0, cpa: 0, roas: 0, ctr: 0 },
        accounts,
        budgets: {},
        role: employeeRole,
      });
    }

    // Step 2: For each account, fetch statuses + insights in parallel
    interface AdRow {
      account: string;
      account_id: string;
      campaign: unknown;
      campaign_id: string;
      adset: unknown;
      adset_id: string;
      ad: unknown;
      ad_id: string;
      status: string;
      // Raw effective_status for the parent campaign/adset — needed so the
      // admin can toggle those entities on/off from the table without drilling
      // all the way to an ad. May be "UNKNOWN" if the structure fetch missed.
      campaign_status: string;
      adset_status: string;
      spend: number;
      link_clicks: number;
      cpa: number;
      roas: number;
      add_to_cart: number;
      purchases: number;
      landing_page_views: number;
      cost_per_lpv: number;
      reach: number;
      impressions: number;
      ctr: number;
      preview_url: string | null;
      thumbnail_url: string | null;
      updated_time: string | null;        // ad's own updated_time
      adset_updated_time: string | null;  // parent adset's updated_time
      campaign_updated_time: string | null; // parent campaign's updated_time
      start_time: string | null;
    }

    // Budget maps: entity ID → budget info
    const budgets: Record<string, { daily_budget: number | null; lifetime_budget: number | null }> = {};
    const allRows: AdRow[] = [];
    const accountStatusMap: Record<string, AccountInfo> = {};

    await Promise.all(
      targetAccounts.map(async (account) => {
        accountStatusMap[account.account_id] = account;

        // Check structure cache for this account (campaigns/adsets/ads don't change per date)
        const structKey = `structure:${account.id}`;
        const cachedStruct = structureCache.get(structKey);
        const hasStructCache = !forceRefresh && cachedStruct && Date.now() - cachedStruct.timestamp < STRUCTURE_CACHE_TTL;

        // Only fetch insights fresh — structure from cache if available
        type CampaignRaw = { id: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; updated_time?: string };
        type AdsetRaw = { id: string; effective_status: string; campaign_id: string; daily_budget?: string; lifetime_budget?: string; updated_time?: string; start_time?: string; created_time?: string };
        type AdRaw = { id: string; effective_status: string; adset_id: string; updated_time?: string };

        const [campaignsRaw, adsetsRaw, adsRaw, insightsData] = hasStructCache
          ? [
              ...(cachedStruct.data as [CampaignRaw[], AdsetRaw[], AdRaw[]]),
              await fbFetchAll<Record<string, unknown>>(
                `/${account.id}/insights`, token,
                { fields: INSIGHTS_FIELDS, ...insightsDateParam, level: "ad", limit: "500" }
              ).catch(() => [] as Array<Record<string, unknown>>),
            ]
          : await Promise.all([
            fbFetchAll<CampaignRaw>(
              `/${account.id}/campaigns`,
              token,
              { fields: "id,effective_status,daily_budget,lifetime_budget,updated_time", limit: "500" }
            ).catch((e) => {
              console.error(`[FB all-ads] campaigns fetch failed for ${account.name}:`, e instanceof Error ? e.message : e);
              return [] as CampaignRaw[];
            }),

            fbFetchAll<AdsetRaw>(
              `/${account.id}/adsets`,
              token,
              { fields: "id,effective_status,campaign_id,daily_budget,lifetime_budget,updated_time,start_time,created_time", limit: "500" }
            ).catch((e) => {
              console.error(`[FB all-ads] adsets fetch failed for ${account.name}:`, e instanceof Error ? e.message : e);
              return [] as AdsetRaw[];
            }),

            fbFetchAll<AdRaw>(
              `/${account.id}/ads`,
              token,
              {
                // Stripped creative{} expansion — too slow, was causing
                // /ads to time out and leave all statuses as UNKNOWN.
                // Creatives can be fetched lazily at ad-drill level.
                fields: "id,effective_status,adset_id,updated_time",
                limit: "500",
              }
            ).catch((e) => {
              console.error(`[FB all-ads] ads fetch failed for ${account.name}:`, e instanceof Error ? e.message : e);
              return [] as AdRaw[];
            }),

            fbFetchAll<Record<string, unknown>>(
              `/${account.id}/insights`,
              token,
              {
                fields: INSIGHTS_FIELDS,
                ...insightsDateParam,
                level: "ad",
                limit: "500",
              }
            ).catch((e) => {
              console.error(`[FB all-ads] insights fetch failed for ${account.name}:`, e instanceof Error ? e.message : e);
              return [] as Array<Record<string, unknown>>;
            }),
          ]);

        // Save structure to cache (campaigns/adsets/ads — not insights)
        // Only cache if we actually got ad data — otherwise all statuses would show "OFF"
        if (!hasStructCache && adsRaw.length > 0) {
          structureCache.set(structKey, {
            data: [campaignsRaw, adsetsRaw, adsRaw],
            timestamp: Date.now(),
          });
        }

        // Build status maps + budget maps + time maps
        const campaignStatus: Record<string, string> = {};
        const campaignUpdated: Record<string, string> = {};
        for (const c of campaignsRaw) {
          campaignStatus[c.id] = c.effective_status;
          if (c.updated_time) campaignUpdated[c.id] = c.updated_time;
          budgets[c.id] = {
            daily_budget: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
            lifetime_budget: c.lifetime_budget ? parseInt(c.lifetime_budget) / 100 : null,
          };
        }

        const adsetStatus: Record<string, string> = {};
        const adsetToCampaign: Record<string, string> = {};
        const adsetUpdated: Record<string, string> = {};
        const adsetStartTime: Record<string, string> = {};
        for (const a of adsetsRaw) {
          adsetStatus[a.id] = a.effective_status;
          adsetToCampaign[a.id] = a.campaign_id;
          if (a.updated_time) adsetUpdated[a.id] = a.updated_time;
          // Fall back to created_time when start_time is missing — older
          // adsets without an explicit schedule still have created_time
          if (a.start_time) adsetStartTime[a.id] = a.start_time;
          else if (a.created_time) adsetStartTime[a.id] = a.created_time;
          budgets[a.id] = {
            daily_budget: a.daily_budget ? parseInt(a.daily_budget) / 100 : null,
            lifetime_budget: a.lifetime_budget ? parseInt(a.lifetime_budget) / 100 : null,
          };
        }

        const adEffStatus: Record<string, string> = {};
        const adToAdset: Record<string, string> = {};
        const adUpdated: Record<string, string> = {};
        // Creative preview/thumbnail no longer fetched in main payload
        // (was causing /ads to time out). Lazy-load in ad-drill view if needed.
        const adPreview: Record<string, { url: string | null; thumbnail: string | null }> = {};
        for (const a of adsRaw) {
          adEffStatus[a.id] = a.effective_status;
          adToAdset[a.id] = a.adset_id;
          if (a.updated_time) adUpdated[a.id] = a.updated_time;
          adPreview[a.id] = { url: null, thumbnail: null };
        }

        function getDeliveryStatus(adId: string): string {
          if (!account.is_active) return `ACCOUNT ${account.status_label}`;

          const adSt = adEffStatus[adId];
          // Ad missing from structure fetch — DON'T infer ACTIVE from parents
          // since campaign/adset can be ACTIVE while individual ads are PAUSED.
          // Show UNKNOWN so user knows status couldn't be verified.
          if (!adSt) return "UNKNOWN";

          const adsetId = adToAdset[adId];
          const adsetSt = adsetId ? adsetStatus[adsetId] : undefined;
          const campaignId = adsetId ? adsetToCampaign[adsetId] : undefined;
          const campaignSt = campaignId ? campaignStatus[campaignId] : undefined;

          if (campaignSt && campaignSt !== "ACTIVE") return `CAMPAIGN ${campaignSt}`;
          if (adsetSt && adsetSt !== "ACTIVE") return `ADSET ${adsetSt}`;
          if (adSt !== "ACTIVE") return adSt;

          return "ACTIVE";
        }

        // Parse insights
        for (const row of insightsData) {
          const actions =
            (row.actions as Array<{ action_type: string; value: string }>) || [];
          const actionValues =
            (row.action_values as Array<{ action_type: string; value: string }>) || [];
          const costPerAction =
            (row.cost_per_action_type as Array<{ action_type: string; value: string }>) || [];

          const getAction = (
            arr: Array<{ action_type: string; value: string }>,
            type: string
          ) => parseFloat(arr.find((a) => a.action_type === type)?.value || "0");

          const spend = parseFloat((row.spend as string) || "0");
          const purchases =
            getAction(actions, "purchase") ||
            getAction(actions, "offsite_conversion.fb_pixel_purchase");
          const purchaseValue =
            getAction(actionValues, "purchase") ||
            getAction(actionValues, "offsite_conversion.fb_pixel_purchase");
          const addToCart =
            getAction(actions, "add_to_cart") ||
            getAction(actions, "offsite_conversion.fb_pixel_add_to_cart");
          const linkClicks = getAction(actions, "link_click");
          const landingPageViews = getAction(actions, "landing_page_view");
          const cpa =
            getAction(costPerAction, "purchase") ||
            getAction(costPerAction, "offsite_conversion.fb_pixel_purchase");
          const costPerLpv = landingPageViews > 0 ? spend / landingPageViews : 0;
          const roas = spend > 0 ? purchaseValue / spend : 0;

          const adId = row.ad_id as string;

          const campaignIdStr = row.campaign_id as string;
          const adsetIdStr = (adToAdset[adId] || (row.adset_id as string)) as string;
          allRows.push({
            account: account.name,
            account_id: account.id,
            campaign: row.campaign_name,
            campaign_id: campaignIdStr,
            adset: row.adset_name,
            adset_id: row.adset_id as string,
            ad: row.ad_name,
            ad_id: adId,
            status: getDeliveryStatus(adId),
            campaign_status: campaignStatus[campaignIdStr] || "UNKNOWN",
            adset_status: adsetStatus[adsetIdStr] || "UNKNOWN",
            spend,
            link_clicks: linkClicks,
            cpa,
            roas,
            add_to_cart: addToCart,
            purchases,
            landing_page_views: landingPageViews,
            cost_per_lpv: Math.round(costPerLpv * 100) / 100,
            reach: parseInt((row.reach as string) || "0"),
            impressions: parseInt((row.impressions as string) || "0"),
            ctr: parseFloat((row.ctr as string) || "0"),
            preview_url: adPreview[adId]?.url || null,
            thumbnail_url: adPreview[adId]?.thumbnail || null,
            updated_time: adUpdated[adId] || null,
            adset_updated_time: adsetUpdated[adToAdset[adId] || (row.adset_id as string)] || null,
            campaign_updated_time: campaignUpdated[row.campaign_id as string] || null,
            start_time: adsetStartTime[adToAdset[adId] || (row.adset_id as string)] || null,
          });
        }
      })
    );

    // Totals
    const totals = allRows.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        link_clicks: acc.link_clicks + r.link_clicks,
        purchases: acc.purchases + r.purchases,
        add_to_cart: acc.add_to_cart + r.add_to_cart,
        reach: acc.reach + r.reach,
        impressions: acc.impressions + r.impressions,
      }),
      { spend: 0, link_clicks: 0, purchases: 0, add_to_cart: 0, reach: 0, impressions: 0 }
    );

    const responseData = {
      data: allRows,
      totals: {
        ...totals,
        count: allRows.length,
        cpa: totals.purchases > 0 ? totals.spend / totals.purchases : 0,
        roas:
          totals.spend > 0
            ? allRows.reduce(
                (s, r) => s + r.roas * r.spend,
                0
              ) / totals.spend
            : 0,
        ctr:
          totals.impressions > 0
            ? (totals.link_clicks / totals.impressions) * 100
            : 0,
      },
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        account_id: a.account_id,
        status: a.status_label,
        is_active: a.is_active,
      })),
      budgets,
    };

    // Write to Supabase cache (non-blocking)
    // Skip caching if all rows are UNKNOWN — indicates structure fetch failed
    // and caching would propagate bad "OFF"-like data for 30 minutes
    const allUnknown = allRows.length > 0 && allRows.every((r) => r.status === "UNKNOWN");
    const refreshedAt = new Date().toISOString();
    if (!allUnknown) {
      setCachedResponse(supabase, "ads", cacheKey, responseData).catch(() => {});
    }

    return Response.json({ ...responseData, role: employeeRole, refreshed_at: refreshedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Facebook API error";
    return Response.json({ error: message }, { status: 500 });
  }
}
