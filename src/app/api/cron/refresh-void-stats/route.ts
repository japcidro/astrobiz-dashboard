import { createServiceClient } from "@/lib/supabase/service";
import { VOID_SETTLEMENT_DAYS } from "@/lib/profit/formulas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHOPIFY_API_VERSION = "2024-01";

/**
 * How far back to sample. Cohorts younger than SETTLED_AFTER_DAYS still have
 * cancellations coming, so including them would understate the void rate —
 * exactly the bias we're trying to remove.
 */
const SETTLED_AFTER_DAYS = 15;
const SAMPLE_WINDOW_DAYS = 90;

type RawOrder = {
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  total_price: string;
};

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
      fields: "created_at,cancelled_at,financial_status,total_price",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    all.push(...(json.orders || []));
    const next = (res.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
  }
  return all;
}

/**
 * Days since the Unix epoch in PHT. The P&L measures a date's age in whole
 * calendar days, so the settlement curve has to be built the same way —
 * an order placed 11pm Monday and cancelled 1am Tuesday was live for all of
 * Monday, and must count as settling on day 1, not day 0.
 */
function phtDayIndex(iso: string): number {
  return Math.floor((new Date(iso).getTime() + 8 * 60 * 60 * 1000) / 86_400_000);
}

/**
 * Measure how often a store's orders get cancelled, and how long it takes.
 *
 * void_rate is measured on VALUE rather than count, because the P&L correction
 * is applied to revenue. settlement_curve is likewise value-weighted, so a
 * handful of large late cancellations aren't averaged away by many small
 * early ones.
 */
function computeStats(orders: RawOrder[]): {
  voidRate: number;
  curve: number[];
  sampleOrders: number;
} {
  let gross = 0;
  let voided = 0;
  const lagValues: { ageDays: number; value: number }[] = [];

  for (const o of orders) {
    const price = parseFloat(o.total_price) || 0;
    gross += price;
    const isDead =
      !!o.cancelled_at ||
      o.financial_status === "voided" ||
      o.financial_status === "refunded";
    if (!isDead) continue;
    voided += price;
    if (o.cancelled_at) {
      const ageDays = phtDayIndex(o.cancelled_at) - phtDayIndex(o.created_at);
      lagValues.push({ ageDays: Math.max(0, ageDays), value: price });
    }
  }

  const voidRate = gross > 0 ? voided / gross : 0;
  const totalLagged = lagValues.reduce((s, r) => s + r.value, 0);

  // curve[i] = share of voided value already cancelled by the end of the date's
  // age-i calendar day — the same age the P&L computes for a date.
  const curve: number[] = [];
  for (let age = 0; age <= VOID_SETTLEMENT_DAYS; age++) {
    if (totalLagged <= 0) {
      curve.push(1);
      continue;
    }
    const settled = lagValues
      .filter((r) => r.ageDays <= age)
      .reduce((s, r) => s + r.value, 0);
    curve.push(settled / totalLagged);
  }
  // Whatever hasn't settled by the end of the window is treated as settled —
  // otherwise old dates would keep a permanent discount they never earn back.
  curve[curve.length - 1] = 1;

  return { voidRate, curve, sampleOrders: orders.length };
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: stores, error: storesError } = await supabase
    .from("shopify_stores")
    .select("name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !stores) {
    return Response.json(
      { error: storesError?.message || "Failed to load stores" },
      { status: 500 }
    );
  }

  const now = Date.now();
  const maxMs = now - SETTLED_AFTER_DAYS * 86_400_000;
  const minMs = maxMs - SAMPLE_WINDOW_DAYS * 86_400_000;
  const createdAtMax = new Date(maxMs).toISOString();
  const createdAtMin = new Date(minMs).toISOString();

  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const store of stores) {
    try {
      const orders = await fetchOrders(
        store.store_url,
        store.api_token,
        createdAtMin,
        createdAtMax
      );
      const { voidRate, curve, sampleOrders } = computeStats(orders);

      // A thin sample produces a noisy rate. Better to leave the store
      // unadjusted than to apply a number built on a handful of orders.
      if (sampleOrders < 50) {
        errors.push(
          `${store.name}: only ${sampleOrders} settled orders in the window — left unadjusted`
        );
        continue;
      }

      const { error } = await supabase.from("store_void_stats").upsert(
        {
          store_name: store.name.toUpperCase(),
          void_rate: voidRate,
          settlement_curve: curve,
          sample_orders: sampleOrders,
          sample_from: createdAtMin.slice(0, 10),
          sample_to: createdAtMax.slice(0, 10),
          refreshed_at: new Date().toISOString(),
        },
        { onConflict: "store_name" }
      );
      if (error) throw new Error(error.message);

      results.push({
        store: store.name.toUpperCase(),
        void_rate: Math.round(voidRate * 10000) / 100,
        sample_orders: sampleOrders,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[refresh-void-stats] ${store.name}:`, msg);
      errors.push(`${store.name}: ${msg}`);
    }
  }

  return Response.json({ updated: results, errors });
}
