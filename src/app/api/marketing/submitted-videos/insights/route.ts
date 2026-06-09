import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface ActionItem {
  action_type: string;
  value: string;
}

// GET ?fb_ad_id=...  → lifetime spend + purchases (and revenue/ROAS) for one
// ad, straight from FB Insights. Returns has_data=false for ads that haven't
// delivered yet (scheduled / brand new), since those have no insights row.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fbAdId = searchParams.get("fb_ad_id");
  if (!fbAdId) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;

  try {
    const res = await fetch(
      `${FB_API_BASE}/${fbAdId}/insights?fields=spend,actions,action_values&date_preset=maximum&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = await res.json();
    if (!res.ok) {
      const msg =
        (json?.error?.error_user_msg as string) ||
        (json?.error?.message as string) ||
        `Facebook error ${res.status}`;
      return Response.json({ error: msg }, { status: 502 });
    }

    const row = (json?.data as Array<Record<string, unknown>> | undefined)?.[0];
    if (!row) {
      // No insights yet — ad hasn't delivered.
      return Response.json({
        data: { has_data: false, spend: 0, purchases: 0, revenue: 0, roas: 0 },
      });
    }

    const actions = (row.actions as ActionItem[]) || [];
    const actionValues = (row.action_values as ActionItem[]) || [];
    const getAction = (arr: ActionItem[], type: string) =>
      parseFloat(arr.find((a) => a.action_type === type)?.value || "0");

    const spend = parseFloat((row.spend as string) || "0");
    const purchases =
      getAction(actions, "purchase") ||
      getAction(actions, "offsite_conversion.fb_pixel_purchase");
    const revenue =
      getAction(actionValues, "purchase") ||
      getAction(actionValues, "offsite_conversion.fb_pixel_purchase");
    const roas = spend > 0 ? revenue / spend : 0;

    return Response.json({
      data: { has_data: spend > 0 || purchases > 0, spend, purchases, revenue, roas },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load results";
    return Response.json({ error: message }, { status: 500 });
  }
}
