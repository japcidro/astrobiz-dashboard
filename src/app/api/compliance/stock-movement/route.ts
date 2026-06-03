// Compliance — Stock movement extract for the accountant.
//
// Shopify's API does NOT expose a historical inventory ledger, so this route
// reconstructs stock movement from the three sources we DO have authoritative
// access to:
//
//   1. movements  — every adjustment the dashboard performed (RTS restocks,
//                   manual adjusts, pick/pack deductions) from inventory_adjustments
//   2. sales_out  — units that left as sales, aggregated from Shopify orders
//   3. snapshot   — current on-hand stock per SKU, live from Shopify
//
// All three are returned together; the client packs them into one .xlsx with
// a sheet each. Admin-only.

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  computeComplianceRange,
  toPhtDateStr,
  type ComplianceDateFilter,
} from "@/lib/compliance/date-range";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// ---------- Types ----------

interface AdjustmentRow {
  id: string;
  store_id: string;
  sku: string | null;
  product_title: string | null;
  adjustment_type: string;
  previous_qty: number | null;
  new_qty: number | null;
  change_qty: number | null;
  reason: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface MovementRow {
  date: string;
  store: string;
  sku: string;
  product: string;
  type: string;
  reason: string;
  previous_qty: number | null;
  new_qty: number | null;
  change_qty: number | null;
  performed_by: string;
}

export interface SalesOutRow {
  date: string;
  store: string;
  sku: string;
  product: string;
  units_sold: number;
}

export interface SnapshotRow {
  store: string;
  sku: string;
  product: string;
  variant: string;
  current_qty: number;
}

interface RawOrder {
  id: number;
  created_at: string;
  cancelled_at: string | null;
  line_items: {
    title: string;
    variant_title: string | null;
    quantity: number;
    sku: string | null;
  }[];
}

interface RawProduct {
  title: string;
  variants: {
    title: string;
    sku: string | null;
    inventory_quantity: number;
  }[];
}

// ---------- Shopify fetchers ----------

async function fetchOrders(
  storeUrl: string,
  apiToken: string,
  createdAtMin: string,
  createdAtMax: string
): Promise<RawOrder[]> {
  const all: RawOrder[] = [];
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: "any",
      created_at_min: createdAtMin,
      created_at_max: createdAtMax,
      limit: "250",
      fields: "id,created_at,cancelled_at,line_items",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify orders error (${res.status}): ${text.slice(0, 160)}`);
    }
    const json = await res.json();
    all.push(...(json.orders || []));
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return all;
}

async function fetchProducts(
  storeUrl: string,
  apiToken: string
): Promise<RawProduct[]> {
  const all: RawProduct[] = [];
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/products.json?` +
    new URLSearchParams({
      status: "active",
      limit: "250",
      fields: "title,variants",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify products error (${res.status}): ${text.slice(0, 160)}`);
    }
    const json = await res.json();
    all.push(...(json.products || []));
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return all;
}

// ---------- Handler ----------

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFilter = (searchParams.get("date_filter") || "this_month") as ComplianceDateFilter;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const storeFilter = searchParams.get("store") || "ALL";

  const { startDate, endDate, createdAtMin, createdAtMax } = computeComplianceRange(
    dateFilter,
    dateFrom,
    dateTo
  );

  const supabase = await createClient();

  // --- Stores (used for name mapping + Shopify credentials) ---
  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData || storesData.length === 0) {
    return Response.json(
      { error: "No active Shopify stores configured. Go to Settings." },
      { status: 400 }
    );
  }

  const storeNameById = new Map(storesData.map((s) => [s.id, s.name]));
  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.id === storeFilter);

  const warnings: string[] = [];

  // --- Employee name map (for the "performed_by" column) ---
  const { data: employeesData } = await supabase
    .from("employees")
    .select("id, full_name");
  const employeeNameById = new Map(
    (employeesData || []).map((e) => [e.id, e.full_name])
  );

  // --- 1. Movements (inventory_adjustments ledger) ---
  const targetStoreIds = new Set(targetStores.map((s) => s.id));
  const { data: adjustments, error: adjError } = await fetchAllRows<AdjustmentRow>(
    () =>
      supabase
        .from("inventory_adjustments")
        .select(
          "id, store_id, sku, product_title, adjustment_type, previous_qty, new_qty, change_qty, reason, performed_by, created_at"
        )
        .gte("created_at", createdAtMin)
        .lte("created_at", createdAtMax),
    { orderColumn: "created_at", ascending: true }
  );

  if (adjError) {
    warnings.push(`Movements: ${adjError.message}`);
  }

  const movements: MovementRow[] = (adjustments || [])
    .filter((a) => targetStoreIds.has(a.store_id))
    .map((a) => ({
      date: toPhtDateStr(a.created_at),
      store: storeNameById.get(a.store_id) || a.store_id,
      sku: a.sku || "—",
      product: a.product_title || "—",
      type: a.adjustment_type,
      reason: a.reason || "",
      previous_qty: a.previous_qty,
      new_qty: a.new_qty,
      change_qty: a.change_qty,
      performed_by: a.performed_by
        ? employeeNameById.get(a.performed_by) || "Unknown"
        : "System",
    }));

  // --- 2 & 3. Sales-out + current snapshot (live from Shopify, per store) ---
  const salesMap = new Map<string, SalesOutRow>(); // key: date::store::sku
  const snapshot: SnapshotRow[] = [];

  await Promise.all(
    targetStores.map(async (store) => {
      // Sales out
      try {
        const orders = await fetchOrders(
          store.store_url,
          store.api_token,
          createdAtMin,
          createdAtMax
        );
        for (const order of orders) {
          if (order.cancelled_at) continue; // cancelled = not shipped
          const dateStr = toPhtDateStr(order.created_at);
          for (const li of order.line_items || []) {
            if (!li.quantity) continue;
            const sku = li.sku || "—";
            const key = `${dateStr}::${store.name}::${sku}`;
            const existing = salesMap.get(key);
            if (existing) {
              existing.units_sold += li.quantity;
            } else {
              salesMap.set(key, {
                date: dateStr,
                store: store.name,
                sku,
                product: li.title || "—",
                units_sold: li.quantity,
              });
            }
          }
        }
      } catch (err) {
        warnings.push(
          `${store.name} sales: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }

      // Current snapshot
      try {
        const products = await fetchProducts(store.store_url, store.api_token);
        for (const p of products) {
          for (const v of p.variants || []) {
            snapshot.push({
              store: store.name,
              sku: v.sku || "—",
              product: p.title,
              variant: v.title === "Default Title" ? "Default" : v.title,
              current_qty: v.inventory_quantity,
            });
          }
        }
      } catch (err) {
        warnings.push(
          `${store.name} snapshot: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    })
  );

  const salesOut = Array.from(salesMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store)
  );
  snapshot.sort(
    (a, b) => a.store.localeCompare(b.store) || a.product.localeCompare(b.product)
  );

  const totalUnitsSold = salesOut.reduce((sum, r) => sum + r.units_sold, 0);
  const netAdjusted = movements.reduce((sum, r) => sum + (r.change_qty || 0), 0);
  const totalOnHand = snapshot.reduce((sum, r) => sum + r.current_qty, 0);

  return Response.json({
    movements,
    salesOut,
    snapshot,
    summary: {
      movement_count: movements.length,
      net_adjusted_units: netAdjusted,
      total_units_sold: totalUnitsSold,
      snapshot_skus: snapshot.length,
      total_units_on_hand: totalOnHand,
      date_from: startDate,
      date_to: endDate,
    },
    stores: storesData.map((s) => ({ id: s.id, name: s.name })),
    warnings,
  });
}
