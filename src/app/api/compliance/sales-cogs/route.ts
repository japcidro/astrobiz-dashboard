// Compliance — per-day Gross Sales + COGS extract for the accountant.
//
// Replicates the EXACT revenue/COGS logic of /api/profit/daily so the numbers
// reconcile 1:1 with the CEO's Net Profit tab:
//   - Gross Sales = sum of order total_price (cancelled/voided/refunded excluded)
//   - COGS        = cogs_items.cogs_per_unit × qty, matched by store+sku
//
// Aggregated per PHT day (scoped by the store filter). Admin-only.

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  computeComplianceRange,
  toPhtDateStr,
  type ComplianceDateFilter,
} from "@/lib/compliance/date-range";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

interface RawOrder {
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  total_price: string;
  line_items: { sku: string | null; quantity: number }[];
}

export interface SalesCogsRow {
  date: string;
  orders: number;
  gross_sales: number;
  cogs: number;
  gross_profit: number;
}

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
      fields: "created_at,cancelled_at,financial_status,total_price,line_items",
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

  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.id === storeFilter);

  // COGS lookup — same keying as the P&L tab (STORE upper :: sku lower)
  const { data: cogsData } = await supabase
    .from("cogs_items")
    .select("store_name, sku, cogs_per_unit");
  const cogsMap = new Map<string, number>();
  for (const item of cogsData || []) {
    const key = `${(item.store_name || "").toUpperCase()}::${(item.sku || "").toLowerCase()}`;
    cogsMap.set(key, item.cogs_per_unit);
  }

  const revenueByDate = new Map<string, number>();
  const ordersByDate = new Map<string, number>();
  const cogsByDate = new Map<string, number>();
  const missingCogsSkus = new Set<string>();
  const warnings: string[] = [];

  await Promise.all(
    targetStores.map(async (store) => {
      try {
        const orders = await fetchOrders(
          store.store_url,
          store.api_token,
          createdAtMin,
          createdAtMax
        );
        const normalizedStore = store.name.toUpperCase();

        for (const order of orders) {
          if (order.cancelled_at) continue;
          if (
            order.financial_status === "voided" ||
            order.financial_status === "refunded"
          )
            continue;

          const dateStr = toPhtDateStr(order.created_at);

          const price = parseFloat(order.total_price) || 0;
          revenueByDate.set(dateStr, (revenueByDate.get(dateStr) || 0) + price);
          ordersByDate.set(dateStr, (ordersByDate.get(dateStr) || 0) + 1);

          for (const li of order.line_items || []) {
            const sku = (li.sku || "").toLowerCase();
            if (!sku) continue;
            const cogsPerUnit = cogsMap.get(`${normalizedStore}::${sku}`);
            if (cogsPerUnit != null) {
              cogsByDate.set(
                dateStr,
                (cogsByDate.get(dateStr) || 0) + cogsPerUnit * li.quantity
              );
            } else {
              missingCogsSkus.add(`${normalizedStore}::${li.sku}`);
            }
          }
        }
      } catch (err) {
        warnings.push(
          `${store.name}: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    })
  );

  const round = (n: number) => Math.round(n * 100) / 100;

  const rows: SalesCogsRow[] = Array.from(revenueByDate.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const gross = revenueByDate.get(date) || 0;
      const cogs = cogsByDate.get(date) || 0;
      return {
        date,
        orders: ordersByDate.get(date) || 0,
        gross_sales: round(gross),
        cogs: round(cogs),
        gross_profit: round(gross - cogs),
      };
    });

  const totalGross = rows.reduce((s, r) => s + r.gross_sales, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);

  if (missingCogsSkus.size > 0) {
    warnings.push(
      `${missingCogsSkus.size} SKU(s) missing COGS data — COGS column understated for those items. Manage COGS in P&L → COGS.`
    );
  }

  return Response.json({
    rows,
    summary: {
      total_gross_sales: round(totalGross),
      total_cogs: round(totalCogs),
      total_gross_profit: round(totalGross - totalCogs),
      total_orders: totalOrders,
      date_from: startDate,
      date_to: endDate,
    },
    stores: storesData.map((s) => ({ id: s.id, name: s.name })),
    warnings,
  });
}
