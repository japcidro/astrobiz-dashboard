import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolvePublicAppUrl } from "@/lib/app-url";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Everything the dashboard calls: orders (with customers), products and
// variants, inventory levels and adjustments, locations, fulfillments and
// fulfillment orders. A Dev Dashboard app grants the scopes declared in its
// version, so keep that list the same as this one. (read_all_orders is not
// accepted there — the Dev Dashboard calls it an invalid scope.)
const SCOPES = [
  "read_orders",
  "read_customers",
  "read_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_fulfillments",
  "write_fulfillments",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
].join(",");

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id");

  if (!storeId) {
    return Response.json({ error: "Missing store_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: store } = await supabase
    .from("shopify_stores")
    .select("id, store_url, client_id")
    .eq("id", storeId)
    .single();

  if (!store || !store.client_id) {
    return Response.json(
      { error: "Store not found or missing Client ID" },
      { status: 400 }
    );
  }

  // Build the Shopify OAuth authorization URL
  const appUrl = resolvePublicAppUrl(request);
  const redirectUri = `${appUrl}/api/shopify/auth/callback`;

  // Use store_id as the state param so we know which store to update on callback
  const authUrl =
    `https://${store.store_url}/admin/oauth/authorize?` +
    new URLSearchParams({
      client_id: store.client_id,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state: storeId,
    });

  return NextResponse.redirect(authUrl);
}
