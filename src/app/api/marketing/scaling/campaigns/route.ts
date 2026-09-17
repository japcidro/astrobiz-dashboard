import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchCampaigns } from "@/lib/facebook/structure";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

function acctPrefix(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

// Meta returns ["NONE"] for a campaign with no special category; a new
// campaign must be created with [] instead, or the call is rejected.
function cleanCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v))
    .filter((v) => v && v !== "NONE");
}

// Every campaign a promoted ad could land in, for the "Target campaign" step
// of the promote modals. Scoped to one ad account — Meta's /copies API
// cannot cross ad accounts, so a campaign anywhere else is not a destination
// we could honour.
//
// Query: ?store=CAPSULED     — the account that store's scaling campaign
//                              lives in, and `configured` describes that
//                              campaign: its objective and special ad
//                              categories, which a brand-new campaign copies
//                              so a cloned ad set stays compatible with it.
// Query: ?account_id=act_123 — any ad account, for a store with no scaling
//                              campaign mapped yet. `configured` comes back
//                              null: there is no default destination, so the
//                              caller has to name a campaign or create one.
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
  if (!store && !requestedAccount) {
    return Response.json(
      { error: "store or account_id required" },
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

  const accountId = acctPrefix(
    String(scalingRow?.account_id ?? requestedAccount)
  );

  // The account's campaigns and the mapped one's own settings are
  // independent reads — the mapped campaign may well be missing from the
  // list (archived, or in a state fetchCampaigns filters out) and the
  // "New campaign" defaults still need its objective.
  const [{ campaigns, error }, configured] = await Promise.all([
    fetchCampaigns(accountId, token),
    (async () => {
      if (!scalingRow) return null;
      try {
        const res = await fetch(
          `${FB_API_BASE}/${scalingRow.campaign_id}?fields=id,name,objective,special_ad_categories,buying_type&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!res.ok) return null;
        return {
          id: String(json.id),
          name: (json.name as string) ?? scalingRow.campaign_name,
          objective: (json.objective as string) ?? null,
          special_ad_categories: cleanCategories(json.special_ad_categories),
        };
      } catch {
        return null;
      }
    })(),
  ]);

  // A partial read still beats an empty dropdown — report both.
  if (error && campaigns.length === 0) {
    return Response.json({ error }, { status: 502 });
  }

  return Response.json({
    account_id: accountId,
    // With a mapping, fall back to its own columns so the picker can always
    // name the configured campaign even when Graph would not tell us about
    // it. Without one, there is no default destination to offer.
    configured: scalingRow
      ? (configured ?? {
          id: String(scalingRow.campaign_id),
          name: String(scalingRow.campaign_name),
          objective: null,
          special_ad_categories: [],
        })
      : null,
    campaigns,
    warning: error,
  });
}
