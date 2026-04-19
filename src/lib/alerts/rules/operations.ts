import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "../insert";

// ===================================================================
// Rule: autopilot_big_action
// Trigger: Autopilot paused/resumed ads totaling >= ₱1000/day spend
// in the last 24h.
// ===================================================================
export async function detectAutopilotBigAction(
  supabase: SupabaseClient
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("autopilot_actions")
    .select("id, action, rule_matched, spend, ad_id, created_at, run_id")
    .gte("created_at", since)
    .eq("status", "ok")
    .in("action", ["paused", "resumed"]);

  const rows = data ?? [];
  if (rows.length === 0) return 0;

  // Group by run_id — one alert per run
  const runs = new Map<string, { paused: number; resumed: number; totalSpend: number; count: number }>();
  for (const row of rows) {
    const runId = row.run_id as string;
    const agg = runs.get(runId) ?? { paused: 0, resumed: 0, totalSpend: 0, count: 0 };
    if (row.action === "paused") agg.paused++;
    if (row.action === "resumed") agg.resumed++;
    agg.totalSpend += Number(row.spend ?? 0);
    agg.count++;
    runs.set(runId, agg);
  }

  let alertCount = 0;
  for (const [runId, agg] of runs.entries()) {
    if (agg.totalSpend < 1000) continue;

    const parts: string[] = [];
    if (agg.paused > 0) parts.push(`paused ${agg.paused}`);
    if (agg.resumed > 0) parts.push(`resumed ${agg.resumed}`);

    const id = await insertAlert(supabase, {
      type: "autopilot_big_action",
      severity: "info",
      title: `Autopilot ${parts.join(" / ")} ads (₱${Math.round(agg.totalSpend).toLocaleString()} affected)`,
      body: `Review autopilot activity log to confirm actions were correct.`,
      resource_type: "autopilot_run",
      resource_id: runId,
      action_url: `/marketing/ads?tab=autopilot`,
      payload: {
        run_id: runId,
        paused: agg.paused,
        resumed: agg.resumed,
        total_spend: agg.totalSpend,
        count: agg.count,
      },
      dedup_hours: 24,
    });
    if (id) alertCount++;
  }
  return alertCount;
}

// ===================================================================
// Rule: rts_spike
// Trigger: Yesterday's RTS count > 2× past 7-day average.
// ===================================================================
export async function detectRtsSpike(
  supabase: SupabaseClient
): Promise<number> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("jt_deliveries")
    .select("submission_date, classification")
    .gte("submission_date", weekAgo);

  const rows = (data ?? []) as { submission_date: string; classification: string }[];
  if (rows.length === 0) return 0;

  const rtsByDate = new Map<string, number>();
  for (const row of rows) {
    const cls = (row.classification || "").toLowerCase();
    if (!cls.includes("rts") && !cls.includes("return")) continue;
    rtsByDate.set(row.submission_date, (rtsByDate.get(row.submission_date) ?? 0) + 1);
  }

  const yesterdayCount = rtsByDate.get(yesterday) ?? 0;
  if (yesterdayCount < 5) return 0; // ignore tiny numbers

  // Average across the 7 days before yesterday
  let sum = 0;
  let count = 0;
  for (const [date, c] of rtsByDate.entries()) {
    if (date === yesterday) continue;
    sum += c;
    count++;
  }
  const avg = count > 0 ? sum / count : 0;
  if (avg === 0) return 0;
  if (yesterdayCount < avg * 2) return 0;

  const id = await insertAlert(supabase, {
    type: "rts_spike",
    severity: "urgent",
    title: `RTS spike: ${yesterdayCount} returns yesterday (avg ${avg.toFixed(1)})`,
    body: `Yesterday's RTS count is ${(yesterdayCount / avg).toFixed(1)}× the 7-day average. Check for province, courier, or product issues.`,
    resource_type: "system",
    resource_id: `rts_spike:${yesterday}`,
    action_url: `/admin/jt-dashboard`,
    payload: {
      date: yesterday,
      count: yesterdayCount,
      avg_7d: Number(avg.toFixed(2)),
      ratio: Number((yesterdayCount / avg).toFixed(2)),
    },
    dedup_hours: 48,
  });
  return id ? 1 : 0;
}

// ===================================================================
// Rule: cash_at_risk
// Trigger: J&T aged-past-cutoff value > ₱50k (based on unpaid/returned
// parcels classified past their tier cutoff).
// ===================================================================
export async function detectCashAtRisk(
  supabase: SupabaseClient
): Promise<number> {
  // Parcels submitted >= cutoff-days ago that are still not delivered
  const cutoffDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("jt_deliveries")
    .select("amount, classification, order_status, submission_date")
    .lte("submission_date", cutoffDate);

  const rows = (data ?? []) as {
    amount: number | null;
    classification: string | null;
    order_status: string | null;
    submission_date: string;
  }[];

  const atRisk = rows.filter((r) => {
    const cls = (r.classification || "").toLowerCase();
    const status = (r.order_status || "").toLowerCase();
    return (
      cls.includes("rts") ||
      cls.includes("return") ||
      cls.includes("aged") ||
      status.includes("problem") ||
      status.includes("return")
    );
  });

  const totalAtRisk = atRisk.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  if (totalAtRisk < 50000) return 0;

  const id = await insertAlert(supabase, {
    type: "cash_at_risk",
    severity: "urgent",
    title: `₱${Math.round(totalAtRisk).toLocaleString()} at risk in aged parcels`,
    body: `${atRisk.length} parcels past their tier cutoff with RTS/aged classification. Review J&T dashboard for province/courier patterns.`,
    resource_type: "system",
    resource_id: `cash_at_risk:${new Date().toISOString().slice(0, 10)}`,
    action_url: `/admin/jt-dashboard`,
    payload: {
      total_at_risk: totalAtRisk,
      parcel_count: atRisk.length,
    },
    dedup_hours: 24,
  });
  return id ? 1 : 0;
}

// ===================================================================
// Rule: store_outage
// Trigger: Shopify shop endpoint returns 4xx/5xx or times out.
// Probes the store directly using its stored token — no internal API.
// ===================================================================
export async function detectStoreOutage(
  supabase: SupabaseClient,
  _baseUrl: string,
  _cronSecret: string
): Promise<number> {
  const { data: stores } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (!stores || stores.length === 0) return 0;

  let alertCount = 0;
  for (const store of stores as Array<{
    id: string;
    name: string;
    store_url: string | null;
    api_token: string | null;
  }>) {
    if (!store.store_url || !store.api_token) continue;

    try {
      const res = await fetch(
        `https://${store.store_url}/admin/api/2024-01/shop.json`,
        {
          headers: { "X-Shopify-Access-Token": store.api_token },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (res.ok) continue;

      const body = await res.text();
      const id = await insertAlert(supabase, {
        type: "store_outage",
        severity: "urgent",
        title: `${store.name} Shopify connection failing`,
        body: `Store returned ${res.status} from Shopify. First 200 chars: ${body.slice(0, 200)}`,
        resource_type: "store",
        resource_id: String(store.id),
        action_url: `/admin/settings`,
        payload: {
          store_id: store.id,
          store_name: store.name,
          http_status: res.status,
        },
        dedup_hours: 6,
      });
      if (id) alertCount++;
    } catch (err) {
      const id = await insertAlert(supabase, {
        type: "store_outage",
        severity: "urgent",
        title: `${store.name} Shopify connection timeout`,
        body: err instanceof Error ? err.message : "Unknown error",
        resource_type: "store",
        resource_id: String(store.id),
        action_url: `/admin/settings`,
        payload: { store_id: store.id, store_name: store.name, error: String(err) },
        dedup_hours: 6,
      });
      if (id) alertCount++;
    }
  }
  return alertCount;
}
