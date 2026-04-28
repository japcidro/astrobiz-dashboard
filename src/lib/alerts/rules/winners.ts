import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "../insert";

interface AdRow {
  ad_id: string;
  ad_name?: string;
  spend: number;
  roas: number;
  purchases: number;
  account_id?: string;
  campaign_name?: string;
}

const NEW_WINNER_MIN_SPEND = 5000;
const NEW_WINNER_MIN_ROAS = 5.0;

// ===================================================================
// Rule: new_winner
// Trigger: Ad with 7-day spend >= ₱5k and ROAS >= 5.0 that hasn't
// been flagged before as a new_winner. Dedup per ad_id for 14d.
// This is the rollup early-warning. The strict "clear winner"
// classification (3 consecutive days at 5+ ROAS) lives in
// classifyConsistency / auto-deconstruct-winners.
// ===================================================================
export async function detectNewWinners(
  supabase: SupabaseClient,
  baseUrl: string,
  cronSecret: string
): Promise<number> {
  const params = new URLSearchParams({
    date_preset: "last_7_days",
    account: "ALL",
  });

  const res = await fetch(`${baseUrl}/api/facebook/all-ads?${params}`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[new_winner] FB all-ads fetch failed", res.status);
    return 0;
  }

  const payload = (await res.json()) as { ads?: AdRow[] };
  const ads = payload.ads ?? [];
  if (ads.length === 0) return 0;

  let alertCount = 0;
  for (const ad of ads) {
    if (ad.spend < NEW_WINNER_MIN_SPEND) continue;
    if (ad.roas < NEW_WINNER_MIN_ROAS) continue;

    const id = await insertAlert(supabase, {
      type: "new_winner",
      severity: "action",
      title: `New winner: ${ad.ad_name ?? ad.ad_id}`,
      body: `Spent ₱${ad.spend.toLocaleString()} in the last 7 days at ${ad.roas.toFixed(2)}x ROAS (${ad.purchases} purchases). Consider budget boost.`,
      resource_type: "ad",
      resource_id: ad.ad_id,
      action_url: `/marketing/ads?ad_id=${encodeURIComponent(ad.ad_id)}`,
      payload: {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name ?? null,
        spend: ad.spend,
        roas: ad.roas,
        purchases: ad.purchases,
        account_id: ad.account_id ?? null,
        campaign_name: ad.campaign_name ?? null,
      },
      dedup_hours: 24 * 14, // don't re-alert same ad for 14 days
    });

    if (id) alertCount++;
  }
  return alertCount;
}
