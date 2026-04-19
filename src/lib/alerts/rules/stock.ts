import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "../insert";

interface Snapshot {
  store_name: string;
  sku: string | null;
  variant_id: string | null;
  product_title: string | null;
  stock: number;
}

// Fetch today's and N-days-ago inventory snapshots for every SKU.
// Returns a map keyed by "store_name|sku|variant_id".
async function loadSnapshots(
  supabase: SupabaseClient,
  date: string
): Promise<Map<string, Snapshot>> {
  const { data } = await supabase
    .from("inventory_snapshots")
    .select("store_name, sku, variant_id, product_title, stock")
    .eq("snapshot_date", date);
  const map = new Map<string, Snapshot>();
  for (const row of (data ?? []) as Snapshot[]) {
    map.set(`${row.store_name}|${row.sku ?? ""}|${row.variant_id ?? ""}`, row);
  }
  return map;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ===================================================================
// Rule: stock_restocked_winner
// Trigger: SKU went from <20 → >=50 in the last 3 days AND had
// decreasing stock over the previous 7 days (indicating it was moving).
// ===================================================================
export async function detectStockRestockedWinner(
  supabase: SupabaseClient
): Promise<number> {
  const today = daysAgo(0);
  const recent = daysAgo(3);
  const weekPrior = daysAgo(10);

  const [todayMap, recentMap, weekPriorMap] = await Promise.all([
    loadSnapshots(supabase, today),
    loadSnapshots(supabase, recent),
    loadSnapshots(supabase, weekPrior),
  ]);

  if (todayMap.size === 0) return 0;

  let alertCount = 0;
  for (const [key, todayRow] of todayMap.entries()) {
    const recentRow = recentMap.get(key);
    const weekPriorRow = weekPriorMap.get(key);
    if (!recentRow || !weekPriorRow) continue;

    const recentStock = recentRow.stock;
    const todayStock = todayRow.stock;
    const weekPriorStock = weekPriorRow.stock;

    // Restock condition: was low (<20), now healthy (>=50)
    const wasLow = recentStock < 20;
    const nowHealthy = todayStock >= 50;
    if (!wasLow || !nowHealthy) continue;

    // Had past-7d velocity signal (stock was dropping before restock)
    const weekPriorVelocity = weekPriorStock - recentStock;
    if (weekPriorVelocity < 10) continue; // needs to have sold at least 10 over the week

    const restockedAmount = todayStock - recentStock;
    const productLabel = todayRow.product_title ?? todayRow.sku ?? "Unknown SKU";
    const sku = todayRow.sku ?? todayRow.variant_id ?? key;

    const id = await insertAlert(supabase, {
      type: "stock_restocked_winner",
      severity: "action",
      title: `${productLabel} restocked — safe to scale ads?`,
      body: `Stock went from ${recentStock} → ${todayStock} (+${restockedAmount}). Sold ~${weekPriorVelocity} units in the week before the dip. Check if paused ads should resume.`,
      resource_type: "sku",
      resource_id: sku,
      action_url: `/fulfillment/inventory?search=${encodeURIComponent(productLabel)}`,
      payload: {
        store_name: todayRow.store_name,
        stock_now: todayStock,
        stock_3d_ago: recentStock,
        stock_10d_ago: weekPriorStock,
        restocked_amount: restockedAmount,
        week_prior_velocity: weekPriorVelocity,
      },
      dedup_hours: 72,
    });

    if (id) alertCount++;
  }
  return alertCount;
}

// ===================================================================
// Rule: stock_depleting_winner
// Trigger: SKU current stock < 3 days of runway at past-7-day velocity.
// Only fires when weekly velocity >= 10 (filters out dead SKUs).
// ===================================================================
export async function detectStockDepletingWinner(
  supabase: SupabaseClient
): Promise<number> {
  const today = daysAgo(0);
  const weekAgo = daysAgo(7);

  const [todayMap, weekAgoMap] = await Promise.all([
    loadSnapshots(supabase, today),
    loadSnapshots(supabase, weekAgo),
  ]);

  if (todayMap.size === 0) return 0;

  let alertCount = 0;
  for (const [key, todayRow] of todayMap.entries()) {
    const weekAgoRow = weekAgoMap.get(key);
    if (!weekAgoRow) continue;

    const velocityPerWeek = weekAgoRow.stock - todayRow.stock;
    if (velocityPerWeek < 10) continue;

    const velocityPerDay = velocityPerWeek / 7;
    const runwayDays = todayRow.stock / velocityPerDay;
    if (runwayDays >= 3) continue;
    if (todayRow.stock <= 0) continue; // already out — will be caught by a separate rule

    const productLabel = todayRow.product_title ?? todayRow.sku ?? "Unknown SKU";
    const sku = todayRow.sku ?? todayRow.variant_id ?? key;

    const id = await insertAlert(supabase, {
      type: "stock_depleting_winner",
      severity: "urgent",
      title: `${productLabel} runs out in ${runwayDays.toFixed(1)} days`,
      body: `Only ${todayRow.stock} units left, selling ~${velocityPerDay.toFixed(1)}/day. Reorder or pause ads to avoid stockout.`,
      resource_type: "sku",
      resource_id: sku,
      action_url: `/fulfillment/inventory?search=${encodeURIComponent(productLabel)}`,
      payload: {
        store_name: todayRow.store_name,
        stock_now: todayRow.stock,
        stock_7d_ago: weekAgoRow.stock,
        velocity_per_day: Number(velocityPerDay.toFixed(2)),
        runway_days: Number(runwayDays.toFixed(2)),
      },
      dedup_hours: 24,
    });

    if (id) alertCount++;
  }
  return alertCount;
}
