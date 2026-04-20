import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// GET /api/shopify/variants?store=Capsuled&ids=123,456
// Returns { [variant_id]: { sku, barcode } } so callers can match scans
// against the CURRENT variant SKU / barcode — not the snapshot saved on
// historical orders.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeName = searchParams.get("store");
  const idsParam = searchParams.get("ids");

  if (!storeName || !idsParam) {
    return Response.json(
      { error: "store and ids query params are required" },
      { status: 400 }
    );
  }

  const variantIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (variantIds.length === 0) {
    return Response.json({ variants: {} });
  }

  const supabase = await createClient();
  const { data: store, error: storeError } = await supabase
    .from("shopify_stores")
    .select("store_url, api_token")
    .eq("name", storeName)
    .eq("is_active", true)
    .single();

  if (storeError || !store) {
    return Response.json(
      { error: `Store "${storeName}" not found` },
      { status: 404 }
    );
  }

  const variants: Record<string, { sku: string | null; barcode: string | null }> = {};

  await Promise.all(
    variantIds.map(async (vid) => {
      try {
        const res = await fetch(
          `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/variants/${vid}.json?fields=id,sku,barcode`,
          {
            headers: { "X-Shopify-Access-Token": store.api_token },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const json = await res.json();
          if (json.variant) {
            variants[vid] = {
              sku: json.variant.sku || null,
              barcode: json.variant.barcode || null,
            };
          }
        }
      } catch {
        // swallow — caller falls back to historical line_item values
      }
    })
  );

  return Response.json({ variants });
}
