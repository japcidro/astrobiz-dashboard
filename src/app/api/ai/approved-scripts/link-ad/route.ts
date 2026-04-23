import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// POST /api/ai/approved-scripts/link-ad
// Body: { fb_ad_id, fb_ad_account_id, approved_script_id }
// Links a live Facebook ad to an approved script. Upserts on fb_ad_id
// so re-linking replaces the existing row. Insert-trigger on the table
// auto-flips the script's status 'approved' → 'in_production'.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    fb_ad_id?: string;
    fb_ad_account_id?: string;
    approved_script_id?: string;
  };

  if (!body.fb_ad_id || !body.fb_ad_account_id || !body.approved_script_id) {
    return Response.json(
      {
        error:
          "fb_ad_id, fb_ad_account_id, and approved_script_id are required",
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ad_approved_script_links")
    .upsert(
      {
        fb_ad_id: body.fb_ad_id,
        fb_ad_account_id: body.fb_ad_account_id,
        approved_script_id: body.approved_script_id,
        linked_by: employee.id,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "fb_ad_id" }
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ link: data });
}

// DELETE /api/ai/approved-scripts/link-ad
// Body: { fb_ad_id }
// Removes the link. Doesn't touch the script's status — once marked
// 'in_production' it stays that way until the marketer changes it.
export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { fb_ad_id?: string };
  if (!body.fb_ad_id) {
    return Response.json({ error: "fb_ad_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ad_approved_script_links")
    .delete()
    .eq("fb_ad_id", body.fb_ad_id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
