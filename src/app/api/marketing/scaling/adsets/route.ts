import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

function normalizeAcct(v: string | null | undefined): string {
  return (v ?? "").toString().replace(/^act_/, "").trim();
}

// Lists adsets inside a campaign the promote modals can target. Used both
// for picking a drop-in destination and for picking the template an ad set
// clone copies its targeting and budget from.
//
// Query: ?store=CAPSULED                  — the store's scaling campaign.
// Query: ?store=CAPSULED&campaign_id=123   — any other campaign in the same
//   ad account as that store's scaling campaign.
// Query: ?account_id=act_1&campaign_id=123 — for a store with no scaling
//   campaign mapped yet: any campaign in the ad account the ads are in.
//
// Either way the campaign must live in the named ad account. Meta's /copies
// cannot cross ad accounts, so anything outside it could never be a
// destination.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");
  const requestedAccount = (searchParams.get("account_id") ?? "").trim();
  const requestedCampaignId = (searchParams.get("campaign_id") ?? "").trim();
  if (!store && !requestedAccount) {
    return Response.json(
      { error: "store or account_id required" },
      { status: 400 }
    );
  }
  if (!store && !requestedCampaignId) {
    return Response.json(
      { error: "campaign_id required when no store is given" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const [{ data: tokenRow }, { data: scalingRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    store
      ? supabase
          .from("store_scaling_campaigns")
          .select("*")
          .eq("store_name", store)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  if (store && !scalingRow) {
    return Response.json(
      { error: `No scaling campaign mapped for store "${store}"` },
      { status: 404 }
    );
  }

  const accountId = String(scalingRow?.account_id ?? requestedAccount);
  let campaignId = scalingRow ? String(scalingRow.campaign_id) : "";
  let campaignName = scalingRow ? String(scalingRow.campaign_name) : "";

  if (requestedCampaignId && requestedCampaignId !== campaignId) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/${requestedCampaignId}?fields=id,name,account_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "campaign lookup failed");
      }
      if (
        normalizeAcct(json.account_id as string) !== normalizeAcct(accountId)
      ) {
        return Response.json(
          {
            error: store
              ? `Campaign ${requestedCampaignId} is not in the same ad account as the "${store}" scaling campaign.`
              : `Campaign ${requestedCampaignId} is not in ad account ${accountId}.`,
          },
          { status: 400 }
        );
      }
      campaignId = String(json.id);
      campaignName = (json.name as string) ?? campaignId;
    } catch (err) {
      return Response.json(
        {
          error: `Could not read campaign: ${err instanceof Error ? err.message : "unknown"}`,
        },
        { status: 502 }
      );
    }
  }

  try {
    const res = await fetch(
      `${FB_API_BASE}/${campaignId}/adsets?fields=id,name,effective_status,daily_budget,lifetime_budget&limit=200&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `FB error ${res.status}`);
    }
    // Exclude only terminal states. CAMPAIGN_PAUSED / ADSET_PAUSED /
    // WITH_ISSUES / PENDING_REVIEW etc. are still live and can be used as
    // a clone template or a drop-in destination — filtering them out made
    // the modal look like the scaling campaign was empty whenever it was
    // itself paused.
    const EXCLUDED_STATUSES = new Set([
      "ARCHIVED",
      "DELETED",
    ]);
    const adsets = ((json.data ?? []) as Array<{
      id: string;
      name: string;
      effective_status: string;
      daily_budget?: string;
      lifetime_budget?: string;
    }>)
      .filter((a) => !EXCLUDED_STATUSES.has(a.effective_status))
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({
      campaign: {
        id: campaignId,
        name: campaignName,
        account_id: accountId,
      },
      adsets,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "FB fetch failed" },
      { status: 502 }
    );
  }
}
