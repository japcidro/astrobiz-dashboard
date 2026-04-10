import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const storeId = searchParams.get("state"); // we passed store_id as state
  const shop = searchParams.get("shop"); // e.g. "my-store.myshopify.com"

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  if (!code || !storeId) {
    const url = new URL("/admin/settings", appUrl);
    url.searchParams.set("shopify_error", "Missing code or state from Shopify");
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();

  // Fetch the store to get client_id and client_secret
  const { data: store, error: fetchError } = await supabase
    .from("shopify_stores")
    .select("id, store_url, client_id, client_secret")
    .eq("id", storeId)
    .single();

  if (fetchError || !store) {
    // RLS might block the read — try without auth context by using the store_id directly
    const url = new URL("/admin/settings", appUrl);
    url.searchParams.set(
      "shopify_error",
      `Could not read store: ${fetchError?.message || "not found"}. Try refreshing the page and reconnecting.`
    );
    return NextResponse.redirect(url);
  }

  if (!store.client_id || !store.client_secret) {
    const url = new URL("/admin/settings", appUrl);
    url.searchParams.set("shopify_error", "Store missing Client ID or Secret");
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
      const url = new URL("/admin/settings", appUrl);
      url.searchParams.set(
        "shopify_error",
        `Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`
      );
      return NextResponse.redirect(url);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    if (!accessToken) {
      const url = new URL("/admin/settings", appUrl);
      url.searchParams.set("shopify_error", `No access token in response: ${JSON.stringify(tokenJson).slice(0, 200)}`);
      return NextResponse.redirect(url);
    }

    // Save the token to the store record
    const { error: updateError } = await supabase
      .from("shopify_stores")
      .update({
        api_token: accessToken,
        store_url: storeUrl,
      })
      .eq("id", storeId);

    if (updateError) {
      const url = new URL("/admin/settings", appUrl);
      url.searchParams.set(
        "shopify_error",
        `Token obtained but failed to save: ${updateError.message}. Token starts with: ${accessToken.slice(0, 10)}...`
      );
      return NextResponse.redirect(url);
    }

    // Verify the token works
    const testRes = await fetch(
      `https://${storeUrl}/admin/api/2024-01/shop.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );

    const successMsg = testRes.ok
      ? `Connected to ${storeUrl}!`
      : `Token saved but test failed (${testRes.status}). The store may need the app re-approved.`;

    const url = new URL("/admin/settings", appUrl);
    url.searchParams.set("shopify_success", successMsg);
    return NextResponse.redirect(url);
  } catch (e) {
    const url = new URL("/admin/settings", appUrl);
    url.searchParams.set(
      "shopify_error",
      e instanceof Error ? e.message : "OAuth failed"
    );
    return NextResponse.redirect(url);
  }
}
