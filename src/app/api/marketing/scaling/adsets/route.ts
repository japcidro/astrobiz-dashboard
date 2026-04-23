import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Lists adsets inside a specific scaling campaign. Used by the
// "Promote to scaling" modal so the user can pick a destination.
// Query: /api/marketing/scaling/adsets?store=CAPSULED
//   → resolves the store's scaling campaign and lists its adsets.
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
  if (!store) {
    return Response.json({ error: "store required" }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: tokenRow }, { data: scalingRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase
      .from("store_scaling_campaigns")
      .select("*")
      .eq("store_name", store)
      .maybeSingle(),
  ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  if (!scalingRow) {
    return Response.json(
      { error: `No scaling campaign mapped for store "${store}"` },
      { status: 404 }
    );
  }

  try {
    const res = await fetch(
      `${FB_API_BASE}/${scalingRow.campaign_id}/adsets?fields=id,name,effective_status,daily_budget,lifetime_budget&limit=200&access_token=${encodeURIComponent(token)}`,
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
        id: scalingRow.campaign_id,
        name: scalingRow.campaign_name,
        account_id: scalingRow.account_id,
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
