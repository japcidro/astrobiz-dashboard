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

const WRITABLE_FIELDS = [
  "ad_account_id",
  "page_id",
  "page_name",
  "pixel_id",
  "website_url",
  "url_parameters",
  "default_cta",
  "default_daily_budget",
  "default_countries",
  "default_age_min",
  "default_age_max",
  "default_primary_text",
  "default_headline",
  "default_description",
  "campaign_name_pattern",
  "adset_name_pattern",
  "ad_name_pattern",
] as const;

// PUT /api/marketing/store-defaults
//   Body: { shopify_store_id, ...fields }
//   Upserts the single-row defaults for that store. Fields left out of the
//   body keep their saved value.
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

  // Only the fields the caller sent are written. A wizard that does not know
  // about a column (the naming patterns, say) must not null it out on save;
  // a new row falls back to the column defaults for anything not sent.
  const payload: Record<string, unknown> = {
    shopify_store_id,
    updated_by: employee.id,
    updated_at: new Date().toISOString(),
  };
  for (const field of WRITABLE_FIELDS) {
    if (field in body) payload[field] = body[field];
  }

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
