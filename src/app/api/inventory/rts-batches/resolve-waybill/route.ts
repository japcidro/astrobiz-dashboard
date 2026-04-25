import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  buildTrackingToOrderMap,
  lookupOrderForWaybill,
  type OrderMatch,
} from "@/lib/shopify/tracking-to-order";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// Cache the cross-store tracking→order map per Fluid Compute instance for 5
// minutes. The map is expensive to build (paginated Shopify call per active
// store, 30-day window) so without this every cold-start waybill scan adds
// 5-10s of latency. The TTL is short enough that newly-fulfilled orders
// from this morning still get picked up by the next refresh.
const TRACKING_MAP_TTL_MS = 5 * 60 * 1000;
let cachedTrackingMap: Map<string, OrderMatch> | null = null;
let cachedTrackingMapAt = 0;

interface RawLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  sku: string | null;
  barcode?: string | null;
  quantity: number;
  variant_id: number | null;
}

interface RawVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
  inventory_item_id: number;
}

interface ResolvedItem {
  shopify_line_item_id: string;
  sku: string | null;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  inventory_item_id: number | null;
  expected_qty: number;
}

type LookupSource = "jt_deliveries" | "shopify_tracking_map";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const waybillRaw = searchParams.get("waybill") ?? "";
  const waybill = waybillRaw.trim().toUpperCase();
  if (!waybill) {
    return Response.json({ error: "waybill is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Resolve the order (jt_deliveries first, Shopify tracking map as fallback).
  let orderMatch: {
    shopify_order_id: string;
    shopify_order_name: string;
    shopify_order_date: string | null;
    shopify_customer_email: string | null;
    store_name: string;
  } | null = null;
  let lookupSource: LookupSource | null = null;
  let receiver: string | null = null;
  let codAmount: number | null = null;

  const { data: jtRow } = await supabase
    .from("jt_deliveries")
    .select(
      "waybill, receiver, store_name, cod_amount, shopify_order_id, shopify_order_name, shopify_order_date, shopify_customer_email"
    )
    .eq("waybill", waybill)
    .maybeSingle();

  if (jtRow) {
    receiver = (jtRow.receiver as string | null) ?? null;
    codAmount = (jtRow.cod_amount as number | null) ?? null;
    if (jtRow.shopify_order_id && jtRow.store_name) {
      orderMatch = {
        shopify_order_id: jtRow.shopify_order_id as string,
        shopify_order_name:
          (jtRow.shopify_order_name as string) || `#${jtRow.shopify_order_id}`,
        shopify_order_date: (jtRow.shopify_order_date as string | null) ?? null,
        shopify_customer_email:
          (jtRow.shopify_customer_email as string | null) ?? null,
        store_name: jtRow.store_name as string,
      };
      lookupSource = "jt_deliveries";
    }
  }

  if (!orderMatch) {
    // Cold-start fallback: J&T sync hasn't run yet (or jt_deliveries row exists
    // without a shopify link). Pull the cross-store tracking map and try there.
    const now = Date.now();
    if (!cachedTrackingMap || now - cachedTrackingMapAt > TRACKING_MAP_TTL_MS) {
      cachedTrackingMap = await buildTrackingToOrderMap(supabase, 30);
      cachedTrackingMapAt = now;
    }
    const found = lookupOrderForWaybill(cachedTrackingMap, waybill);
    if (found) {
      orderMatch = {
        shopify_order_id: found.shopify_order_id,
        shopify_order_name: found.shopify_order_name,
        shopify_order_date: found.shopify_order_date,
        shopify_customer_email: found.shopify_customer_email,
        store_name: found.store_name,
      };
      lookupSource = "shopify_tracking_map";
    }
  }

  // Surface any existing batch for this waybill regardless of resolver outcome,
  // so the modal can prompt resume / block-on-closed before doing anything else.
  const { data: existingBatchRow } = await supabase
    .from("rts_batches")
    .select(
      "id, status, opened_at, closed_at, opened_by, opened_by_employee:employees!rts_batches_opened_by_fkey(full_name)"
    )
    .eq("waybill", waybill)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existingBatch = existingBatchRow
    ? {
        id: existingBatchRow.id as string,
        status: existingBatchRow.status as "open" | "closed",
        opened_at: existingBatchRow.opened_at as string,
        closed_at: (existingBatchRow.closed_at as string | null) ?? null,
        opened_by: existingBatchRow.opened_by as string,
        opened_by_name:
          (existingBatchRow.opened_by_employee as { full_name?: string } | null)
            ?.full_name ?? null,
      }
    : null;

  if (!orderMatch || !lookupSource) {
    return Response.json(
      {
        error: "not_found",
        waybill,
        existing_batch: existingBatch,
      },
      { status: 404 }
    );
  }

  // Resolve the Shopify store row (by name) to get store_url + api_token + id.
  const { data: store, error: storeErr } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("name", orderMatch.store_name)
    .eq("is_active", true)
    .maybeSingle();

  if (storeErr || !store) {
    return Response.json(
      {
        error: "store_not_found",
        message: `Resolved store "${orderMatch.store_name}" is not active in shopify_stores`,
        waybill,
      },
      { status: 422 }
    );
  }

  // Fetch the Shopify order with line items.
  let lineItems: RawLineItem[] = [];
  try {
    const orderRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderMatch.shopify_order_id}.json?fields=id,name,line_items`,
      {
        headers: { "X-Shopify-Access-Token": store.api_token as string },
        cache: "no-store",
      }
    );
    if (!orderRes.ok) {
      const text = await orderRes.text();
      return Response.json(
        {
          error: "shopify_order_fetch_failed",
          message: `Shopify ${orderRes.status}: ${text.slice(0, 200)}`,
          waybill,
        },
        { status: 502 }
      );
    }
    const orderJson = await orderRes.json();
    lineItems = (orderJson.order?.line_items as RawLineItem[] | undefined) ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: "shopify_order_fetch_failed", message, waybill },
      { status: 502 }
    );
  }

  // Fetch current SKU + barcode + inventory_item_id per variant. Mirrors the
  // pick-list route — line items snapshot SKU at order time, but the canonical
  // SKU may have been edited afterwards. inventory_item_id is required for the
  // per-item scan endpoint to bump Shopify stock.
  const variantIds = Array.from(
    new Set(
      lineItems
        .map((li) => li.variant_id)
        .filter((id): id is number => typeof id === "number")
    )
  );

  const variantMap = new Map<number, RawVariant>();
  await Promise.all(
    variantIds.map(async (vid) => {
      try {
        const res = await fetch(
          `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/variants/${vid}.json?fields=id,sku,barcode,inventory_item_id`,
          {
            headers: { "X-Shopify-Access-Token": store.api_token as string },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const json = await res.json();
          if (json.variant) variantMap.set(vid, json.variant as RawVariant);
        }
      } catch {
        // Best-effort. Missing variant data falls back to line-item snapshot.
      }
    })
  );

  const expectedItems: ResolvedItem[] = lineItems.map((li) => {
    const v = li.variant_id ? variantMap.get(li.variant_id) : null;
    return {
      shopify_line_item_id: String(li.id),
      sku: v?.sku ?? li.sku ?? null,
      barcode: v?.barcode ?? li.barcode ?? null,
      product_title: li.title,
      variant_title: li.variant_title,
      inventory_item_id: v?.inventory_item_id ?? null,
      expected_qty: li.quantity,
    };
  });

  return Response.json({
    waybill,
    lookup_source: lookupSource,
    store: {
      id: store.id as string,
      name: store.name as string,
    },
    order: {
      shopify_order_id: orderMatch.shopify_order_id,
      shopify_order_name: orderMatch.shopify_order_name,
      shopify_order_date: orderMatch.shopify_order_date,
      shopify_customer_email: orderMatch.shopify_customer_email,
      receiver,
      cod_amount: codAmount,
    },
    expected_items: expectedItems,
    existing_batch: existingBatch,
  });
}
