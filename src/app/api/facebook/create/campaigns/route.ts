import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchCampaigns } from "@/lib/facebook/structure";

export const dynamic = "force-dynamic";

// Campaigns available to receive a new ad, for the "Add to Existing" step.
// Reads the campaigns edge directly — see lib/facebook/structure.ts for why
// this must not come from the insights payload.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const accountId = new URL(request.url).searchParams.get("account_id");
  if (!accountId) {
    return Response.json({ error: "Missing account_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  const { campaigns, error } = await fetchCampaigns(
    accountId,
    tokenSetting.value as string
  );

  // A partial read still beats an empty dropdown — report both.
  if (error && campaigns.length === 0) {
    return Response.json({ error }, { status: 502 });
  }
  return Response.json({ data: campaigns, warning: error });
}
