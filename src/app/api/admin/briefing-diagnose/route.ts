import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { resolveBriefingBaseUrl } from "@/lib/briefings/base-url";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Admin-only diagnostic that recreates what the morning briefing does,
// step by step, and reports the status + a snippet of each response so
// we can see exactly which underlying call is returning zeros.
//
// Usage: visit /api/admin/briefing-diagnose while logged in as admin.

const SHOPIFY_API_VERSION = "2024-01";

async function probe(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<{
  label: string;
  url: string;
  status: number;
  ok: boolean;
  summary: unknown;
}> {
  try {
    const res = await fetch(url, {
      headers,
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = text.slice(0, 500);
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return {
      label,
      url,
      status: res.status,
      ok: res.ok,
      summary: summarize(parsed),
    };
  } catch (err) {
    return {
      label,
      url,
      status: 0,
      ok: false,
      summary: `fetch threw: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

type JsonObj = Record<string, unknown>;

function summarize(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") return val;
  const obj = val as JsonObj;
  if (obj.error) {
    const e = obj.error as JsonObj;
    return {
      error_message: e.message ?? null,
      error_type: e.type ?? null,
      error_code: e.code ?? null,
    };
  }
  // Profit / orders / ads responses — pick interesting fields.
  const keep: JsonObj = {};
  if ("summary" in obj) keep.summary = obj.summary;
  if ("totals" in obj) keep.totals = obj.totals;
  if ("warnings" in obj && Array.isArray(obj.warnings)) {
    keep.warnings = obj.warnings;
  }
  if ("data" in obj && Array.isArray(obj.data)) {
    keep.data_count = (obj.data as unknown[]).length;
  }
  if ("rows" in obj && Array.isArray(obj.rows)) {
    keep.row_count = (obj.rows as unknown[]).length;
  }
  if ("orders" in obj && Array.isArray(obj.orders)) {
    keep.order_count = (obj.orders as unknown[]).length;
  }
  return keep;
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const cronSecret = process.env.CRON_SECRET ?? "";
  const cronAuth = { Authorization: `Bearer ${cronSecret}` };

  const baseUrl = resolveBriefingBaseUrl(request);

  // -----------------------------
  // 1. Environment + DB state
  // -----------------------------
  const [{ data: fbTokenRow }, { data: storesData }, { data: cogsCount }] =
    await Promise.all([
      supabase
        .from("app_settings")
        .select("value, updated_at")
        .eq("key", "fb_access_token")
        .single(),
      supabase
        .from("shopify_stores")
        .select("id, name, store_url, api_token, is_active")
        .eq("is_active", true),
      supabase.from("cogs_items").select("id", { count: "exact", head: true }),
    ]);

  const fbToken = (fbTokenRow?.value as string | undefined) ?? "";
  const stores = (storesData as Array<{
    id: string;
    name: string;
    store_url: string;
    api_token: string;
    is_active: boolean;
  }> | null) ?? [];

  const dbState = {
    cron_secret_set: cronSecret.length > 0,
    fb_token_set: fbToken.length > 0,
    fb_token_length: fbToken.length,
    active_shopify_stores: stores.map((s) => ({
      name: s.name,
      store_url: s.store_url,
      token_length: (s.api_token ?? "").length,
    })),
    cogs_items_count: (cogsCount as unknown as { length?: number })?.length ?? 0,
  };

  // -----------------------------
  // 2. Probe internal endpoints
  //    (same URLs the briefing cron hits)
  // -----------------------------
  const internalProbes = await Promise.all([
    probe(
      "/api/profit/daily",
      `${baseUrl}/api/profit/daily?${new URLSearchParams({
        store: "ALL",
        date_filter: "yesterday",
        refresh: "1",
      })}`,
      cronAuth
    ),
    probe(
      "/api/facebook/all-ads",
      `${baseUrl}/api/facebook/all-ads?${new URLSearchParams({
        date_preset: "yesterday",
        account: "ALL",
        refresh: "1",
      })}`,
      cronAuth
    ),
    probe(
      "/api/shopify/orders",
      `${baseUrl}/api/shopify/orders?${new URLSearchParams({
        store: "ALL",
        date_filter: "yesterday",
        refresh: "1",
      })}`,
      cronAuth
    ),
  ]);

  // -----------------------------
  // 3. Probe FB token directly
  // -----------------------------
  const fbProbes: Array<{ label: string; status: number; summary: unknown }> = [];
  if (fbToken) {
    fbProbes.push(
      await probe(
        "fb /debug_token",
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(fbToken)}&access_token=${encodeURIComponent(fbToken)}`,
        {}
      )
    );
    fbProbes.push(
      await probe(
        "fb /me/adaccounts",
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=5&access_token=${encodeURIComponent(fbToken)}`,
        {}
      )
    );
  }

  // -----------------------------
  // 4. Probe each Shopify store directly
  // -----------------------------
  const shopifyProbes = await Promise.all(
    stores.map((s) =>
      probe(
        `shopify ${s.name}`,
        `https://${s.store_url}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
        { "X-Shopify-Access-Token": s.api_token }
      )
    )
  );

  return Response.json({
    db_state: dbState,
    internal_probes: internalProbes,
    fb_probes: fbProbes,
    shopify_probes: shopifyProbes,
  });
}
