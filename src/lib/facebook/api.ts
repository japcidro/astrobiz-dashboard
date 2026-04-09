import type {
  FBCampaign,
  FBAdSet,
  FBAd,
  FBInsights,
  DatePreset,
} from "./types";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

const INSIGHTS_FIELDS =
  "spend,reach,impressions,actions,action_values,cost_per_action_type";

function parseInsights(raw: Record<string, unknown>): FBInsights {
  const actions =
    (raw.actions as Array<{ action_type: string; value: string }>) || [];
  const actionValues =
    (raw.action_values as Array<{ action_type: string; value: string }>) || [];
  const costPerAction =
    (raw.cost_per_action_type as Array<{ action_type: string; value: string }>) ||
    [];

  const getAction = (
    arr: Array<{ action_type: string; value: string }>,
    type: string
  ) => parseFloat(arr.find((a) => a.action_type === type)?.value || "0");

  const spend = parseFloat((raw.spend as string) || "0");
  const purchases =
    getAction(actions, "purchase") ||
    getAction(actions, "offsite_conversion.fb_pixel_purchase");
  const purchaseValue =
    getAction(actionValues, "purchase") ||
    getAction(actionValues, "offsite_conversion.fb_pixel_purchase");
  const addToCart =
    getAction(actions, "add_to_cart") ||
    getAction(actions, "offsite_conversion.fb_pixel_add_to_cart");
  const cpa =
    getAction(costPerAction, "purchase") ||
    getAction(costPerAction, "offsite_conversion.fb_pixel_purchase");
  const roas = spend > 0 ? purchaseValue / spend : 0;
  const results = purchases || getAction(actions, "link_click");

  return {
    spend,
    reach: parseInt((raw.reach as string) || "0"),
    impressions: parseInt((raw.impressions as string) || "0"),
    results,
    cpa,
    roas,
    add_to_cart: addToCart,
    purchases,
  };
}

async function fbFetch<T>(
  endpoint: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const searchParams = new URLSearchParams({
    access_token: token,
    ...params,
  });

  const res = await fetch(`${FB_API_BASE}${endpoint}?${searchParams}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(
      error.error?.message || `Facebook API error: ${res.status}`
    );
  }

  return res.json();
}

export async function getAdAccounts(
  token: string
): Promise<Array<{ id: string; name: string; account_id: string }>> {
  const res = await fbFetch<{
    data: Array<{ id: string; name: string; account_id: string }>;
  }>("/me/adaccounts", token, {
    fields: "id,name,account_id",
    limit: "100",
  });
  return res.data;
}

export async function getCampaigns(
  token: string,
  adAccountId: string,
  datePreset: DatePreset = "last_7d"
): Promise<FBCampaign[]> {
  // Step 1: Get campaigns
  const res = await fbFetch<{ data: Array<Record<string, unknown>> }>(
    `/${adAccountId}/campaigns`,
    token,
    {
      fields: "name,status,objective",
      limit: "100",
    }
  );

  // Step 2: Get insights for each campaign in batch
  const campaigns = res.data;
  const ids = campaigns.map((c) => c.id as string);

  let insightsMap: Record<string, FBInsights> = {};
  if (ids.length > 0) {
    try {
      const insightsRes = await fbFetch<{
        data: Array<Record<string, unknown>>;
      }>(`/${adAccountId}/insights`, token, {
        fields: INSIGHTS_FIELDS,
        date_preset: datePreset,
        level: "campaign",
        limit: "500",
      });

      for (const row of insightsRes.data) {
        const campaignId = row.campaign_id as string;
        if (campaignId) {
          insightsMap[campaignId] = parseInsights(row);
        }
      }
    } catch {
      // Insights may fail for some accounts, continue without them
    }
  }

  return campaigns.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    status: c.status as string,
    objective: (c.objective as string) || "",
    insights: insightsMap[c.id as string] || undefined,
  }));
}

export async function getAdSets(
  token: string,
  campaignId: string,
  datePreset: DatePreset = "last_7d"
): Promise<FBAdSet[]> {
  // Get ad sets
  const res = await fbFetch<{ data: Array<Record<string, unknown>> }>(
    `/${campaignId}/adsets`,
    token,
    {
      fields: "name,status",
      limit: "100",
    }
  );

  // Get insights at adset level for this campaign
  let insightsMap: Record<string, FBInsights> = {};
  try {
    const insightsRes = await fbFetch<{
      data: Array<Record<string, unknown>>;
    }>(`/${campaignId}/insights`, token, {
      fields: INSIGHTS_FIELDS,
      date_preset: datePreset,
      level: "adset",
      limit: "500",
    });

    for (const row of insightsRes.data) {
      const adsetId = row.adset_id as string;
      if (adsetId) {
        insightsMap[adsetId] = parseInsights(row);
      }
    }
  } catch {
    // Continue without insights
  }

  return res.data.map((a) => ({
    id: a.id as string,
    name: a.name as string,
    status: a.status as string,
    campaign_id: campaignId,
    insights: insightsMap[a.id as string] || undefined,
  }));
}

export async function getAds(
  token: string,
  adSetId: string,
  datePreset: DatePreset = "last_7d"
): Promise<FBAd[]> {
  // Get ads
  const res = await fbFetch<{ data: Array<Record<string, unknown>> }>(
    `/${adSetId}/ads`,
    token,
    {
      fields: "name,status",
      limit: "100",
    }
  );

  // Get insights at ad level for this adset
  let insightsMap: Record<string, FBInsights> = {};
  try {
    const insightsRes = await fbFetch<{
      data: Array<Record<string, unknown>>;
    }>(`/${adSetId}/insights`, token, {
      fields: INSIGHTS_FIELDS,
      date_preset: datePreset,
      level: "ad",
      limit: "500",
    });

    for (const row of insightsRes.data) {
      const adId = row.ad_id as string;
      if (adId) {
        insightsMap[adId] = parseInsights(row);
      }
    }
  } catch {
    // Continue without insights
  }

  return res.data.map((a) => ({
    id: a.id as string,
    name: a.name as string,
    status: a.status as string,
    adset_id: adSetId,
    insights: insightsMap[a.id as string] || undefined,
  }));
}

export async function getAccountInsights(
  token: string,
  adAccountId: string,
  datePreset: DatePreset = "last_7d"
): Promise<FBInsights | null> {
  try {
    const res = await fbFetch<{ data: Array<Record<string, unknown>> }>(
      `/${adAccountId}/insights`,
      token,
      {
        fields: INSIGHTS_FIELDS,
        date_preset: datePreset,
      }
    );
    return res.data?.[0] ? parseInsights(res.data[0]) : null;
  } catch {
    return null;
  }
}
