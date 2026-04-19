import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Returns only store names + active flag — no api_token, no URLs.
// Safe for marketing role, which needs this to map campaign names to
// stores in AI Analytics. Uses the service client so we don't need
// to expand the shopify_stores RLS policy (it gates the api_token).
export async function GET() {
  const employee = await getEmployee();
  if (
    !employee ||
    !["admin", "va", "fulfillment", "marketing"].includes(employee.role)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("shopify_stores")
    .select("name, is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    names: (data ?? []).map((r) => r.name as string),
  });
}
