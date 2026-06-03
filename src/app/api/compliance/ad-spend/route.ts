// Compliance — Facebook ad spend extract for the accountant.
//
// Pulls a daily spend breakdown straight from the Marketing Insights API at
// adset level, using the same token + selected-account settings the P&L tab
// uses (app_settings.fb_access_token / fb_selected_accounts). Returns flat
// rows the client turns into an .xlsx the accountant can drop into the books.

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  computeComplianceRange,
  type ComplianceDateFilter,
} from "@/lib/compliance/date-range";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface FbInsightRow {
  account_name?: string;
  account_id?: string;
  campaign_name?: string;
  adset_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  date_start?: string;
  date_stop?: string;
}

export interface AdSpendRow {
  date: string;
  account: string;
  campaign: string;
  adset: string;
  spend: number;
  impressions: number;
  reach: number;
}

async function fetchInsightsDaily(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<FbInsightRow[]> {
  const all: FbInsightRow[] = [];
  let url: string =
    `${FB_API_BASE}/act_${accountId}/insights?` +
    new URLSearchParams({
      access_token: token,
      fields: "account_name,account_id,campaign_name,adset_name,spend,impressions,reach",
      level: "adset",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });

  while (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: { message?: string } }).error?.message ||
          `FB API error: ${res.status}`
      );
    }
    const json = await res.json();
    all.push(...(json.data || []));
    url = json.paging?.next || "";
  }
  return all;
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFilter = (searchParams.get("date_filter") || "this_month") as ComplianceDateFilter;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");

  const { startDate, endDate } = computeComplianceRange(dateFilter, dateFrom, dateTo);

  const supabase = await createClient();

  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();

  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured. Connect it in Settings first." },
      { status: 400 }
    );
  }

  const fbToken = tokenSetting.value;
  let accountIds: string[] = [];
  try {
    accountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    accountIds = [];
  }
  const cleanIds = accountIds.map((id: string) => id.replace(/^act_/, ""));

  if (cleanIds.length === 0) {
    return Response.json(
      { error: "No Facebook ad accounts selected. Pick them in Settings first." },
      { status: 400 }
    );
  }

  const rows: AdSpendRow[] = [];
  const warnings: string[] = [];

  await Promise.all(
    cleanIds.map(async (accountId: string) => {
      try {
        const insights = await fetchInsightsDaily(accountId, fbToken, startDate, endDate);
        for (const row of insights) {
          const spend = parseFloat(row.spend || "0");
          rows.push({
            date: row.date_start || "",
            account: row.account_name || `act_${accountId}`,
            campaign: row.campaign_name || "",
            adset: row.adset_name || "",
            spend,
            impressions: parseInt(row.impressions || "0", 10),
            reach: parseInt(row.reach || "0", 10),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        warnings.push(`act_${accountId}: ${message}`);
      }
    })
  );

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));

  const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);

  return Response.json({
    rows,
    summary: {
      total_spend: Math.round(totalSpend * 100) / 100,
      row_count: rows.length,
      date_from: startDate,
      date_to: endDate,
    },
    warnings,
  });
}
