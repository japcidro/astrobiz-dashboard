import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { DatePreset } from "@/lib/facebook/types";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// In-memory cache — survives across requests while server is running
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

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
  params?: Record<string, string>
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
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (!res.ok) {
      const err = await res.json();
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
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const datePreset = (searchParams.get("date_preset") || "today") as DatePreset;
  const accountFilter = searchParams.get("account") || "ALL";
  const forceRefresh = searchParams.get("refresh") === "1";

  // Check cache first (ignore _t timestamp param for cache key)
  const cacheKey = `${datePreset}:${accountFilter}`;
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return Response.json({ ...(cached.data as Record<string, unknown>), role: employee.role, cached: true });
    }
  }

  const supabase = await createClient();

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
        role: employee.role,
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
      spend: number;
      link_clicks: number;
      cpa: number;
      roas: number;
      add_to_cart: number;
      purchases: number;
      reach: number;
      impressions: number;
      ctr: number;
      preview_url: string | null;
      thumbnail_url: string | null;
      updated_time: string | null;
      start_time: string | null;
    }

    // Budget maps: entity ID → budget info
    const budgets: Record<string, { daily_budget: number | null; lifetime_budget: number | null }> = {};
    const allRows: AdRow[] = [];
    const accountStatusMap: Record<string, AccountInfo> = {};

    await Promise.all(
      targetAccounts.map(async (account) => {
        accountStatusMap[account.account_id] = account;

        // Fetch statuses and insights in parallel for this account
        const [campaignsRaw, adsetsRaw, adsRaw, insightsData] =
          await Promise.all([
            fbFetchAll<{
              id: string;
              effective_status: string;
              daily_budget?: string;
              lifetime_budget?: string;
              updated_time?: string;
            }>(
              `/${account.id}/campaigns`,
              token,
              { fields: "id,effective_status,daily_budget,lifetime_budget,updated_time", limit: "500" }
            ).catch(() => [] as Array<{
              id: string;
              effective_status: string;
              daily_budget?: string;
              lifetime_budget?: string;
              updated_time?: string;
            }>),

            fbFetchAll<{
              id: string;
              effective_status: string;
              campaign_id: string;
              daily_budget?: string;
              lifetime_budget?: string;
              updated_time?: string;
              start_time?: string;
            }>(
              `/${account.id}/adsets`,
              token,
              { fields: "id,effective_status,campaign_id,daily_budget,lifetime_budget,updated_time,start_time", limit: "500" }
            ).catch(() => [] as Array<{
              id: string;
              effective_status: string;
              campaign_id: string;
              daily_budget?: string;
              lifetime_budget?: string;
              updated_time?: string;
              start_time?: string;
            }>),

            fbFetchAll<{
              id: string;
              effective_status: string;
              adset_id: string;
              updated_time?: string;
              creative?: {
                id: string;
                effective_object_story_id?: string;
                thumbnail_url?: string;
              };
            }>(
              `/${account.id}/ads`,
              token,
              {
                fields: "id,effective_status,adset_id,updated_time,creative{effective_object_story_id,thumbnail_url}",
                limit: "500",
              }
            ).catch(() => [] as Array<{
              id: string;
              effective_status: string;
              adset_id: string;
              updated_time?: string;
              creative?: {
                id: string;
                effective_object_story_id?: string;
                thumbnail_url?: string;
              };
            }>),

            fbFetchAll<Record<string, unknown>>(
              `/${account.id}/insights`,
              token,
              {
                fields: INSIGHTS_FIELDS,
                date_preset: datePreset,
                level: "ad",
                limit: "500",
              }
            ).catch(() => [] as Array<Record<string, unknown>>),
          ]);

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
          if (a.start_time) adsetStartTime[a.id] = a.start_time;
          budgets[a.id] = {
            daily_budget: a.daily_budget ? parseInt(a.daily_budget) / 100 : null,
            lifetime_budget: a.lifetime_budget ? parseInt(a.lifetime_budget) / 100 : null,
          };
        }

        const adEffStatus: Record<string, string> = {};
        const adToAdset: Record<string, string> = {};
        const adUpdated: Record<string, string> = {};
        const adPreview: Record<string, { url: string | null; thumbnail: string | null }> = {};
        for (const a of adsRaw) {
          adEffStatus[a.id] = a.effective_status;
          adToAdset[a.id] = a.adset_id;
          if (a.updated_time) adUpdated[a.id] = a.updated_time;
          const storyId = a.creative?.effective_object_story_id;
          const postUrl = storyId
            ? `https://www.facebook.com/${storyId.replace("_", "/posts/")}`
            : null;
          adPreview[a.id] = {
            url: postUrl,
            thumbnail: a.creative?.thumbnail_url || null,
          };
        }

        function getDeliveryStatus(adId: string): string {
          if (!account.is_active) return `ACCOUNT ${account.status_label}`;

          const adSt = adEffStatus[adId];
          if (!adSt) return "OFF";

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
          const cpa =
            getAction(costPerAction, "purchase") ||
            getAction(costPerAction, "offsite_conversion.fb_pixel_purchase");
          const roas = spend > 0 ? purchaseValue / spend : 0;

          const adId = row.ad_id as string;

          allRows.push({
            account: account.name,
            account_id: account.id,
            campaign: row.campaign_name,
            campaign_id: row.campaign_id as string,
            adset: row.adset_name,
            adset_id: row.adset_id as string,
            ad: row.ad_name,
            ad_id: adId,
            status: getDeliveryStatus(adId),
            spend,
            link_clicks: linkClicks,
            cpa,
            roas,
            add_to_cart: addToCart,
            purchases,
            reach: parseInt((row.reach as string) || "0"),
            impressions: parseInt((row.impressions as string) || "0"),
            ctr: parseFloat((row.ctr as string) || "0"),
            preview_url: adPreview[adId]?.url || null,
            thumbnail_url: adPreview[adId]?.thumbnail || null,
            updated_time: adUpdated[adId] || adsetUpdated[adToAdset[adId]] || campaignUpdated[row.campaign_id as string] || null,
            start_time: adsetStartTime[adToAdset[adId]] || null,
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

    // Cache the response (without role — role is added per-request)
    cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    return Response.json({ ...responseData, role: employee.role });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Facebook API error";
    return Response.json({ error: message }, { status: 500 });
  }
}
