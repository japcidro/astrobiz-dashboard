import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// POST { fb_ad_id, starred } → star/unstar a creative. Admin + marketing.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { fb_ad_id?: string; starred?: boolean };
  if (!body.fb_ad_id) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const starred = body.starred !== false; // default: star

  if (starred) {
    const { error } = await supabase
      .from("fb_ad_stars")
      .upsert(
        { fb_ad_id: body.fb_ad_id, starred_by: employee.id },
        { onConflict: "fb_ad_id" }
      );
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("fb_ad_stars")
      .delete()
      .eq("fb_ad_id", body.fb_ad_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ data: { fb_ad_id: body.fb_ad_id, is_starred: starred } });
}
