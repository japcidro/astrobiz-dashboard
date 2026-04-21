import type { DatePreset } from "@/lib/facebook/types";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export interface DailyMetricPoint {
  date: string; // YYYY-MM-DD
  spend: number;
  purchases: number;
  purchase_value: number;
  cpp: number; // cost per purchase
  roas: number;
  add_to_cart: number;
  link_clicks: number;
  landing_page_views: number;
  impressions: number;
  reach: number;
  ctr: number;
}

export interface DailyAdMetrics {
  ad_id: string;
  account_id: string;
  daily: DailyMetricPoint[];
  total: {
    spend: number;
    purchases: number;
    purchase_value: number;
    cpp: number;
    roas: number;
    add_to_cart: number;
    link_clicks: number;
    landing_page_views: number;
    impressions: number;
    reach: number;
    ctr: number;
  };
}

const DAILY_FIELDS = [
  "date_start",
  "date_stop",
  "spend",
  "reach",
  "impressions",
  "ctr",
  "actions",
  "action_values",
].join(",");

function getAction(
  arr: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!arr) return 0;
  return parseFloat(arr.find((a) => a.action_type === type)?.value || "0");
}

function parseRow(row: Record<string, unknown>): DailyMetricPoint {
  const actions = row.actions as
    | Array<{ action_type: string; value: string }>
    | undefined;
  const actionValues = row.action_values as
    | Array<{ action_type: string; value: string }>
    | undefined;

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

  return {
    date: (row.date_start as string) || "",
    spend,
    purchases,
    purchase_value: purchaseValue,
    cpp: purchases > 0 ? spend / purchases : 0,
    roas: spend > 0 ? purchaseValue / spend : 0,
    add_to_cart: addToCart,
    link_clicks: linkClicks,
    landing_page_views: landingPageViews,
    impressions: parseInt((row.impressions as string) || "0", 10),
    reach: parseInt((row.reach as string) || "0", 10),
    ctr: parseFloat((row.ctr as string) || "0"),
  };
}

// Fetches per-day insights for a single ad using time_increment=1.
// Used by the comparative analyzer to detect consistency (stable-winner
// vs 1-day spike vs stable-loser vs dead).
export async function fetchAdDailyInsights(
  adId: string,
  accountId: string,
  token: string,
  datePreset: DatePreset,
  timeoutMs = 10000
): Promise<DailyAdMetrics> {
  const url = `${FB_API_BASE}/${adId}/insights?${new URLSearchParams({
    access_token: token,
    fields: DAILY_FIELDS,
    date_preset: datePreset,
    time_increment: "1",
    limit: "200",
  })}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ||
        `FB daily insights error ${res.status} for ad ${adId}`
    );
  }
  const json = (await res.json()) as {
    data: Array<Record<string, unknown>>;
  };
  const daily = (json.data || []).map(parseRow).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const total = daily.reduce(
    (acc, d) => ({
      spend: acc.spend + d.spend,
      purchases: acc.purchases + d.purchases,
      purchase_value: acc.purchase_value + d.purchase_value,
      add_to_cart: acc.add_to_cart + d.add_to_cart,
      link_clicks: acc.link_clicks + d.link_clicks,
      landing_page_views: acc.landing_page_views + d.landing_page_views,
      impressions: acc.impressions + d.impressions,
      reach: Math.max(acc.reach, d.reach),
    }),
    {
      spend: 0,
      purchases: 0,
      purchase_value: 0,
      add_to_cart: 0,
      link_clicks: 0,
      landing_page_views: 0,
      impressions: 0,
      reach: 0,
    }
  );

  return {
    ad_id: adId,
    account_id: accountId,
    daily,
    total: {
      ...total,
      cpp: total.purchases > 0 ? total.spend / total.purchases : 0,
      roas: total.spend > 0 ? total.purchase_value / total.spend : 0,
      ctr:
        total.impressions > 0 ? (total.link_clicks / total.impressions) * 100 : 0,
    },
  };
}

// Classify an ad's consistency using per-day breakdown against user-
// defined winner thresholds.
// - stable-winner: ≥2 consecutive days meeting thresholds
// - spike: exactly 1 day meeting thresholds
// - stable-loser: consistent spend but never meets thresholds, has purchases
// - dead: no purchases at all
export type ConsistencyTier =
  | "stable_winner"
  | "spike"
  | "stable_loser"
  | "dead";

export interface WinnerThresholds {
  max_cpp: number; // e.g., 200
  min_purchases_per_day: number; // e.g., 3
  min_consecutive_days: number; // e.g., 2
}

export const DEFAULT_WINNER_THRESHOLDS: WinnerThresholds = {
  max_cpp: 200,
  min_purchases_per_day: 3,
  min_consecutive_days: 2,
};

export function classifyConsistency(
  metrics: DailyAdMetrics,
  thresholds: WinnerThresholds = DEFAULT_WINNER_THRESHOLDS
): { tier: ConsistencyTier; winning_days: number; max_consecutive: number } {
  const meetsThreshold = (d: DailyMetricPoint): boolean =>
    d.purchases >= thresholds.min_purchases_per_day &&
    d.cpp > 0 &&
    d.cpp <= thresholds.max_cpp;

  const hitDays = metrics.daily.filter(meetsThreshold).length;

  // Longest run of consecutive threshold-meeting days
  let maxConsecutive = 0;
  let current = 0;
  for (const d of metrics.daily) {
    if (meetsThreshold(d)) {
      current += 1;
      if (current > maxConsecutive) maxConsecutive = current;
    } else {
      current = 0;
    }
  }

  if (maxConsecutive >= thresholds.min_consecutive_days) {
    return { tier: "stable_winner", winning_days: hitDays, max_consecutive: maxConsecutive };
  }
  if (hitDays === 1) {
    return { tier: "spike", winning_days: hitDays, max_consecutive: maxConsecutive };
  }
  if (metrics.total.purchases === 0) {
    return { tier: "dead", winning_days: 0, max_consecutive: 0 };
  }
  return { tier: "stable_loser", winning_days: hitDays, max_consecutive: maxConsecutive };
}
