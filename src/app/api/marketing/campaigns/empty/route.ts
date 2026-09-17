import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  campaignCleanupVerdict,
  type CampaignCleanupFacts,
} from "@/lib/marketing/campaign-cleanup";

export const dynamic = "force-dynamic";
// One Graph call per ad account, but a big one — give it room.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 5;

interface GraphCampaign {
  id: string;
  name?: string;
  effective_status?: string;
  created_time?: string;
  ads?: { data?: Array<{ id: string }>; summary?: { total_count?: number } };
  adsets?: {
    data?: Array<{ id: string; status?: string; effective_status?: string }>;
  };
  insights?: {
    data?: Array<{ spend?: string; impressions?: string }>;
  };
}

// Campaigns an admin could safely clear out of an ad account, with the
// evidence behind each verdict. Everything needed to judge one comes back
// in a single expanded read per account — asking Graph for ads, ad sets and
// lifetime insights separately would be a call per campaign, and these
// accounts hold hundreds.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin only — this is the listing behind a destructive action.
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedAccount = (
    new URL(request.url).searchParams.get("account_id") ?? ""
  ).trim();

  const supabase = await createClient();
  const [{ data: tokenRow }, { data: selectedRow }, { data: mappings }] =
    await Promise.all([
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "fb_access_token")
        .single(),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "fb_selected_accounts")
        .single(),
      supabase.from("store_scaling_campaigns").select("campaign_id"),
    ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  const mappedIds = new Set(
    (mappings ?? []).map((m) => String(m.campaign_id))
  );

  let accountIds: string[] = [];
  if (requestedAccount) {
    accountIds = [
      requestedAccount.startsWith("act_")
        ? requestedAccount
        : `act_${requestedAccount}`,
    ];
  } else {
    try {
      accountIds = selectedRow?.value
        ? (JSON.parse(selectedRow.value as string) as string[])
        : [];
    } catch {
      accountIds = [];
    }
  }

  // No explicit selection means every account the token can see.
  if (accountIds.length === 0) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/me/adaccounts?fields=id,account_status&limit=100&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `FB error ${res.status}`);
      }
      accountIds = ((json.data ?? []) as Array<{ id: string; account_status: number }>)
        .filter((a) => a.account_status === 1)
        .map((a) => a.id);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "FB fetch failed" },
        { status: 502 }
      );
    }
  }

  const fields = [
    "id",
    "name",
    "effective_status",
    "created_time",
    // limit(1) is all we need: the question is "any ads at all", and
    // summary carries the real count for the message.
    "ads.limit(1).summary(true){id}",
    "adsets.limit(100){id,status,effective_status}",
    "insights.date_preset(maximum){spend,impressions}",
  ].join(",");

  const rows: Array<
    CampaignCleanupFacts & {
      account_id: string;
      created_time: string | null;
      eligible: boolean;
      blockers: string[];
    }
  > = [];
  const warnings: string[] = [];

  await Promise.all(
    accountIds.map(async (accountId) => {
      let url =
        `${FB_API_BASE}/${accountId}/campaigns?fields=${encodeURIComponent(fields)}` +
        `&limit=100&access_token=${encodeURIComponent(token)}`;
      for (let page = 0; page < MAX_PAGES && url; page++) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          const json = await res.json();
          if (!res.ok) {
            warnings.push(
              `${accountId}: ${json?.error?.message ?? `FB error ${res.status}`}`
            );
            return;
          }
          for (const c of (json.data ?? []) as GraphCampaign[]) {
            const insight = c.insights?.data?.[0];
            const facts: CampaignCleanupFacts = {
              id: c.id,
              name: c.name ?? "(unnamed campaign)",
              effective_status: c.effective_status ?? "UNKNOWN",
              ad_count:
                c.ads?.summary?.total_count ?? (c.ads?.data?.length ?? 0),
              adset_statuses: (c.adsets?.data ?? []).map(
                (a) => a.effective_status ?? a.status ?? "UNKNOWN"
              ),
              spend: Number(insight?.spend ?? 0) || 0,
              impressions: Number(insight?.impressions ?? 0) || 0,
              is_mapped: mappedIds.has(c.id),
            };
            const verdict = campaignCleanupVerdict(facts);
            // Only the clearable ones are worth listing — the whole point
            // is a short list of things that are safe to remove.
            if (!verdict.eligible) continue;
            rows.push({
              ...facts,
              account_id: accountId,
              created_time: c.created_time ?? null,
              eligible: verdict.eligible,
              blockers: verdict.blockers,
            });
          }
          url = (json.paging?.next as string) ?? "";
        } catch (err) {
          warnings.push(
            `${accountId}: ${err instanceof Error ? err.message : "fetch failed"}`
          );
          return;
        }
      }
    })
  );

  rows.sort(
    (a, b) =>
      (b.created_time ?? "").localeCompare(a.created_time ?? "") ||
      a.name.localeCompare(b.name)
  );

  return Response.json({
    accounts_scanned: accountIds,
    campaigns: rows,
    warnings,
  });
}
