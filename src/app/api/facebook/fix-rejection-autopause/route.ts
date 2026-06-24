import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET  /api/facebook/fix-rejection-autopause → list the auto-pause watchlist
//      (scaling-campaign cat ads being watched / already paused).
// DELETE /api/facebook/fix-rejection-autopause?id=UUID → stop watching a row.
//
// The cron (/api/cron/fix-rejection-autopause) updates last_spend each tick
// and flips status watching → paused at the threshold; this endpoint just
// reads/cleans the list for the Fix Rejections page panel.

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fix_rejection_autopause")
    .select(
      "id, ad_id, ad_account_id, campaign_id, spend_threshold, last_spend, status, since_date, paused_at, updated_at, created_at, ad_name, account_name, campaign_name, adset_name, safe_image_name, is_scaling, engagement_applied"
    )
    .in("status", ["watching", "paused"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data ?? [] });
}

export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("fix_rejection_autopause")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
