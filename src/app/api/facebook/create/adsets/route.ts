import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAdsets } from "@/lib/facebook/structure";

export const dynamic = "force-dynamic";

// Ad sets under one campaign, including ones that hold no ads yet — putting
// the first ad into a fresh ad set is a normal thing to want to do.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const campaignId = new URL(request.url).searchParams.get("campaign_id");
  if (!campaignId) {
    return Response.json({ error: "Missing campaign_id" }, { status: 400 });
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

  const { adsets, error } = await fetchAdsets(
    campaignId,
    tokenSetting.value as string
  );

  if (error && adsets.length === 0) {
    return Response.json({ error }, { status: 502 });
  }
  return Response.json({ data: adsets, warning: error });
}
