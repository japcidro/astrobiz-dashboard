import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function assertRole(role: string | undefined) {
  return role === "admin" || role === "marketing";
}

// GET /api/marketing/store-defaults
//   → list every active store joined with its defaults (left join).
// GET /api/marketing/store-defaults?storeId=uuid
//   → single store's defaults (or null if never saved).
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee || !assertRole(employee.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const supabase = await createClient();

  if (storeId) {
    const { data, error } = await supabase
      .from("store_ad_defaults")
      .select("*")
      .eq("shopify_store_id", storeId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from("shopify_stores")
    .select(
      "id, name, store_url, is_active, store_ad_defaults(*)"
    )
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// PUT /api/marketing/store-defaults
//   Body: { shopify_store_id, ...fields }
//   Upserts the single-row defaults for that store.
export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee || !assertRole(employee.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { shopify_store_id } = body;

  if (!shopify_store_id) {
    return NextResponse.json(
      { error: "Missing shopify_store_id" },
      { status: 400 }
    );
  }

  const payload = {
    shopify_store_id,
    ad_account_id: body.ad_account_id ?? null,
    page_id: body.page_id ?? null,
    page_name: body.page_name ?? null,
    pixel_id: body.pixel_id ?? null,
    website_url: body.website_url ?? null,
    url_parameters: body.url_parameters ?? null,
    default_cta: body.default_cta ?? null,
    default_daily_budget: body.default_daily_budget ?? null,
    default_countries: body.default_countries ?? ["PH"],
    default_age_min: body.default_age_min ?? 18,
    default_age_max: body.default_age_max ?? 65,
    campaign_name_pattern: body.campaign_name_pattern ?? null,
    adset_name_pattern: body.adset_name_pattern ?? null,
    ad_name_pattern: body.ad_name_pattern ?? null,
    updated_by: employee.id,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_ad_defaults")
    .upsert(payload, { onConflict: "shopify_store_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
