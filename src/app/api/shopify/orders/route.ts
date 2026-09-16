import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { shopifyFetchOrders, toShopifyOrder } from "@/lib/shopify/fetch-orders";
import type {
  ShopifyOrder,
  OrdersSummary,
  OrderDateFilter,
} from "@/lib/shopify/types";

export const dynamic = "force-dynamic";

// In-memory cache — survives across requests while server is running
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function computeDateRange(
  dateFilter: OrderDateFilter,
  dateFrom?: string | null,
  dateTo?: string | null
): { createdAtMin: string; createdAtMax: string } {
  // Use Philippines timezone (+08:00)
  const PH_OFFSET = "+08:00";
  const nowUtc = new Date();
  // Current time in PH as a local-like date
  const phNow = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const phYear = phNow.getUTCFullYear();
  const phMonth = phNow.getUTCMonth();
  const phDate = phNow.getUTCDate();

  function phStartOfDay(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00${PH_OFFSET}`;
  }

  function phEndOfDay(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T23:59:59${PH_OFFSET}`;
  }

  switch (dateFilter) {
    case "today":
      return {
        createdAtMin: phStartOfDay(phYear, phMonth, phDate),
        createdAtMax: nowUtc.toISOString(),
      };

    case "yesterday": {
      const yesterday = new Date(phNow.getTime() - 24 * 60 * 60 * 1000);
      return {
        createdAtMin: phStartOfDay(
          yesterday.getUTCFullYear(),
          yesterday.getUTCMonth(),
          yesterday.getUTCDate()
        ),
        createdAtMax: phEndOfDay(
          yesterday.getUTCFullYear(),
          yesterday.getUTCMonth(),
          yesterday.getUTCDate()
        ),
      };
    }

    case "last_7d": {
      const d7ago = new Date(phNow.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        createdAtMin: phStartOfDay(
          d7ago.getUTCFullYear(),
          d7ago.getUTCMonth(),
          d7ago.getUTCDate()
        ),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "this_month":
      return {
        createdAtMin: phStartOfDay(phYear, phMonth, 1),
        createdAtMax: nowUtc.toISOString(),
      };

    case "last_30d": {
      const d30ago = new Date(phNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        createdAtMin: phStartOfDay(
          d30ago.getUTCFullYear(),
          d30ago.getUTCMonth(),
          d30ago.getUTCDate()
        ),
        createdAtMax: nowUtc.toISOString(),
      };
    }

    case "custom":
      // dateFrom / dateTo arrive as YYYY-MM-DD PHT calendar dates from the
      // briefing collector and admin filters. Shopify needs full ISO 8601 —
      // passing the bare date treats it as UTC midnight, which makes a
      // single-day range collapse into a 0-second window and returns no
      // orders. Anchor to PHT day boundaries to match the dashboard semantics.
      return {
        createdAtMin: dateFrom ? `${dateFrom}T00:00:00+08:00` : nowUtc.toISOString(),
        createdAtMax: dateTo ? `${dateTo}T23:59:59+08:00` : nowUtc.toISOString(),
      };

    default:
      return {
        createdAtMin: phStartOfDay(phYear, phMonth, phDate),
        createdAtMax: nowUtc.toISOString(),
      };
  }
}

export async function GET(request: Request) {
  // Allow cron jobs to bypass auth using CRON_SECRET.
  // Cron invocations have no user session — service client bypasses RLS.
  const isCron =
    request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  let employee: { role: string } | null = null;
  if (!isCron) {
    employee = await getEmployee();
    if (!employee) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["admin", "va", "fulfillment"].includes(employee.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    employee = { role: "admin" };
  }

  const { searchParams } = new URL(request.url);
  const dateFilter = (searchParams.get("date_filter") ||
    "today") as OrderDateFilter;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const storeFilter = searchParams.get("store") || "ALL";
  const statusFilter = searchParams.get("status") || "all";
  const forceRefresh = searchParams.get("refresh") === "1";

  // Check cache first (ignore _t timestamp param for cache key)
  const cacheKey = `orders-${dateFilter}-${storeFilter}-${statusFilter}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json({
      ...(cached.data as Record<string, unknown>),
      role: employee.role,
      cached: true,
    });
  }

  const supabase = isCron ? createServiceClient() : await createClient();

  // Fetch active stores from shopify_stores table
  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData || storesData.length === 0) {
    return Response.json(
      {
        error: storesError
          ? "Failed to load stores"
          : "No active Shopify stores configured. Go to Settings.",
      },
      { status: 400 }
    );
  }

  // Filter to specific store if requested
  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.id === storeFilter);

  if (targetStores.length === 0) {
    return Response.json({
      orders: [],
      summary: {
        total_orders: 0,
        total_revenue: 0,
        unfulfilled_count: 0,
        fulfilled_count: 0,
        cancelled_count: 0,
        partially_fulfilled_count: 0,
        avg_fulfillment_hours: null,
        cod_count: 0,
        prepaid_count: 0,
        aging_warning_count: 0,
        aging_danger_count: 0,
      } satisfies OrdersSummary,
      stores: storesData.map((s) => ({ id: s.id, name: s.name })),
      warnings: [],
      role: employee.role,
    });
  }

  const { createdAtMin, createdAtMax } = computeDateRange(
    dateFilter,
    dateFrom,
    dateTo
  );

  const warnings: string[] = [];
  const allOrders: ShopifyOrder[] = [];
  const fulfillmentHours: number[] = []; // track hours for avg calculation
  const now = new Date();

  // Fetch orders from all stores in parallel
  await Promise.all(
    targetStores.map(async (store) => {
      try {
        const rawOrders = await shopifyFetchOrders(
          store.store_url,
          store.api_token,
          createdAtMin,
          createdAtMax
        );

        for (const raw of rawOrders) {
          const order = toShopifyOrder(raw, { id: store.id, name: store.name }, now);

          allOrders.push(order);

          // Track fulfillment hours for fulfilled orders (skip dead so
          // fulfilled-then-refunded orders don't skew the SLA metric).
          if (
            !order.is_dead &&
            order.fulfillment_status === "fulfilled" &&
            order.fulfilled_at
          ) {
            const createdMs = new Date(order.created_at).getTime();
            const fulfilledMs = new Date(order.fulfilled_at).getTime();
            if (fulfilledMs > createdMs) {
              fulfillmentHours.push(
                (fulfilledMs - createdMs) / (1000 * 60 * 60)
              );
            }
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`[Shopify] Failed to fetch orders for store "${store.name}":`, message);
        warnings.push(`${store.name}: ${message}`);
      }
    })
  );

  // Apply status filter. Buckets are mutually exclusive: dead wins over
  // everything else, then fulfilled, then partial, then unfulfilled.
  let orders = allOrders;
  switch (statusFilter) {
    case "unfulfilled":
      orders = allOrders.filter(
        (o) => !o.is_dead && o.fulfillment_status !== "fulfilled" && o.fulfillment_status !== "partial"
      );
      break;
    case "fulfilled":
      orders = allOrders.filter(
        (o) => !o.is_dead && o.fulfillment_status === "fulfilled"
      );
      break;
    case "partial":
      orders = allOrders.filter(
        (o) => !o.is_dead && o.fulfillment_status === "partial"
      );
      break;
    case "cancelled":
      orders = allOrders.filter((o) => o.is_dead);
      break;
    case "aging":
      orders = allOrders.filter(
        (o) =>
          !o.is_dead &&
          o.fulfillment_status !== "fulfilled" &&
          (o.age_level === "warning" || o.age_level === "danger")
      );
      break;
    // "all" — no filter
  }

  // Compute avg fulfillment hours
  const avgFulfillmentHours =
    fulfillmentHours.length > 0
      ? Math.round(
          (fulfillmentHours.reduce((a, b) => a + b, 0) /
            fulfillmentHours.length) *
            10
        ) / 10
      : null;

  // Compute summary from the full date-range set (allOrders) so counts don't
  // change when the user narrows by status. Buckets are mutually exclusive
  // and match the status filter above.
  const alive = allOrders.filter((o) => !o.is_dead);
  const summary: OrdersSummary = {
    total_orders: allOrders.length,
    // Net revenue: exclude dead (cancelled/voided/refunded) orders.
    total_revenue: alive.reduce(
      (sum, o) => sum + parseFloat(o.total_price),
      0
    ),
    unfulfilled_count: alive.filter(
      (o) =>
        o.fulfillment_status !== "fulfilled" &&
        o.fulfillment_status !== "partial"
    ).length,
    fulfilled_count: alive.filter((o) => o.fulfillment_status === "fulfilled")
      .length,
    cancelled_count: allOrders.filter((o) => o.is_dead).length,
    partially_fulfilled_count: alive.filter(
      (o) => o.fulfillment_status === "partial"
    ).length,
    avg_fulfillment_hours: avgFulfillmentHours,
    cod_count: alive.filter((o) => o.is_cod).length,
    prepaid_count: alive.filter(
      (o) => !o.is_cod && o.financial_status === "paid"
    ).length,
    aging_warning_count: alive.filter((o) => o.age_level === "warning").length,
    aging_danger_count: alive.filter((o) => o.age_level === "danger").length,
  };

  // Sort by created_at descending (newest first)
  orders.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const responseData = {
    orders,
    summary,
    stores: storesData.map((s) => ({ id: s.id, name: s.name })),
    warnings,
  };

  // Cache the response (without role — role is added per-request)
  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json({ ...responseData, role: employee.role });
}
