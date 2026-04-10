import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCOPES = "read_orders,read_products,read_fulfillments";

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
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
