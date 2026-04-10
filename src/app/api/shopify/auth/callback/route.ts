import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const storeId = searchParams.get("state"); // we passed store_id as state
  const shop = searchParams.get("shop"); // e.g. "my-store.myshopify.com"

  if (!code || !storeId) {
    const url = new URL("/admin/settings", origin);
    url.searchParams.set("shopify_error", "Missing code or state from Shopify");
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();

  // Fetch the store to get client_id and client_secret
  const { data: store } = await supabase
    .from("shopify_stores")
    .select("id, store_url, client_id, client_secret")
    .eq("id", storeId)
    .single();

  if (!store || !store.client_id || !store.client_secret) {
    const url = new URL("/admin/settings", origin);
    url.searchParams.set("shopify_error", "Store not found or missing credentials");
    return NextResponse.redirect(url);
  }

  const storeUrl = shop || store.store_url;

  try {
    // Exchange the code for a permanent access token
    const tokenRes = await fetch(
      `https://${storeUrl}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: store.client_id,
          client_secret: store.client_secret,
          code,
        }),
      }
    );

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      const url = new URL("/admin/settings", origin);
      url.searchParams.set(
        "shopify_error",
        `Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`
      );
      return NextResponse.redirect(url);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    if (!accessToken) {
      const url = new URL("/admin/settings", origin);
      url.searchParams.set("shopify_error", "No access token in response");
      return NextResponse.redirect(url);
    }

    // Save the token to the store record
    await supabase
      .from("shopify_stores")
      .update({
        api_token: accessToken,
        store_url: storeUrl, // update in case shop param differs
      })
      .eq("id", storeId);

    // Redirect back to settings with success
    const url = new URL("/admin/settings", origin);
    url.searchParams.set("shopify_success", `Connected to ${storeUrl}!`);
    return NextResponse.redirect(url);
  } catch (e) {
    const url = new URL("/admin/settings", origin);
    url.searchParams.set(
      "shopify_error",
      e instanceof Error ? e.message : "OAuth failed"
    );
    return NextResponse.redirect(url);
  }
}
