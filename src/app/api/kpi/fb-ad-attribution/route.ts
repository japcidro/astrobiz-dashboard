import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface PostBody {
  fb_ad_id: string;
  ad_name?: string;
  campaign_id?: string;
  is_test?: boolean;
  fb_created_time?: string;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "marketing" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as PostBody;
  if (!body.fb_ad_id) {
    return Response.json({ error: "fb_ad_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("fb_ad_attribution")
    .upsert(
      {
        fb_ad_id: body.fb_ad_id,
        ad_name: body.ad_name ?? null,
        campaign_id: body.campaign_id ?? null,
        created_by: employee.id,
        is_test: body.is_test ?? true,
        tagged_at: new Date().toISOString(),
        fb_created_time: body.fb_created_time ?? new Date().toISOString(),
      },
      { onConflict: "fb_ad_id" },
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "marketing" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = await createClient();

  // Last 7 days of attributed ads, plus joined creator name
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("fb_ad_attribution")
    .select("fb_ad_id, ad_name, campaign_id, is_test, tagged_at, fb_created_time, created_by, employees(full_name)")
    .gte("tagged_at", since)
    .order("tagged_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data ?? [] });
}
