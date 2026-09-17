import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  campaignCleanupVerdict,
  type CampaignCleanupFacts,
} from "@/lib/marketing/campaign-cleanup";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface Body {
  campaign_id?: string;
  // "archive" hides it everywhere and can be undone in Ads Manager.
  // "delete" is Meta's delete: not undoable by anyone.
  mode?: "archive" | "delete";
}

// Archives or deletes ONE empty campaign.
//
// The eligibility the listing showed is re-established here against Graph,
// immediately before acting, and never taken from the request. A list can
// be minutes old — long enough for someone to have put an ad in the
// campaign — and a client is never proof of anything anyway. Same rule
// object as the listing uses, so the two cannot drift apart.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json(
      { error: "Only an admin can remove a campaign" },
      { status: 403 }
    );
  }

  const body = (await request.json()) as Body;
  const campaignId = (body.campaign_id ?? "").trim();
  const mode = body.mode === "delete" ? "delete" : "archive";
  if (!campaignId) {
    return Response.json({ error: "campaign_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: tokenRow }, { data: mappings }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase.from("store_scaling_campaigns").select("campaign_id, store_name"),
  ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  // --- Re-read the campaign's actual state, right now -------------------
  let facts: CampaignCleanupFacts;
  try {
    const fields =
      "id,name,effective_status,ads.limit(1).summary(true){id}," +
      "adsets.limit(100){id,status,effective_status}," +
      "insights.date_preset(maximum){spend,impressions}";
    const res = await fetch(
      `${FB_API_BASE}/${campaignId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `FB error ${res.status}`);
    }
    const insight = json.insights?.data?.[0];
    facts = {
      id: String(json.id),
      name: (json.name as string) ?? campaignId,
      effective_status: (json.effective_status as string) ?? "UNKNOWN",
      ad_count:
        (json.ads?.summary?.total_count as number) ??
        (json.ads?.data?.length ?? 0),
      adset_statuses: (
        (json.adsets?.data ?? []) as Array<{
          status?: string;
          effective_status?: string;
        }>
      ).map((a) => a.effective_status ?? a.status ?? "UNKNOWN"),
      spend: Number(insight?.spend ?? 0) || 0,
      impressions: Number(insight?.impressions ?? 0) || 0,
      is_mapped: (mappings ?? []).some(
        (m) => String(m.campaign_id) === campaignId
      ),
    };
  } catch (err) {
    return Response.json(
      {
        error: `Could not verify the campaign before removing it: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  const verdict = campaignCleanupVerdict(facts);
  if (!verdict.eligible) {
    return Response.json(
      {
        error: `"${facts.name}" cannot be removed: ${verdict.blockers.join("; ")}.`,
        blockers: verdict.blockers,
      },
      { status: 409 }
    );
  }

  // --- Act --------------------------------------------------------------
  try {
    const res = await fetch(
      `${FB_API_BASE}/${campaignId}?access_token=${encodeURIComponent(token)}`,
      mode === "delete"
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ status: "ARCHIVED" }).toString(),
          }
    );
    const json = await res.json();
    if (!res.ok) {
      const msg =
        json?.error?.error_user_msg ??
        json?.error?.message ??
        `FB error ${res.status}`;
      return Response.json(
        { error: `Could not ${mode} "${facts.name}": ${msg}` },
        { status: 502 }
      );
    }
  } catch (err) {
    return Response.json(
      {
        error: `Could not ${mode} "${facts.name}": ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  console.info(
    `[campaigns/cleanup] employee=${employee.id} ${mode} campaign=${campaignId} name="${facts.name}" ads=${facts.ad_count} spend=${facts.spend}`
  );

  return Response.json({
    success: true,
    mode,
    campaign_id: campaignId,
    campaign_name: facts.name,
  });
}
