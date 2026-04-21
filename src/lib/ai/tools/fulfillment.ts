// Fulfillment tools — admin-only. These expose operational data about
// J&T deliveries, pick-pack throughput, and waybill sender mismatches
// (a quality check for the pack team).

import type { SupabaseClient } from "@supabase/supabase-js";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// ─── get_jt_delivery_stats ────────────────────────────────────────────
// Rollup over jt_deliveries by classification (Delivered / Returned /
// For Return / In Transit / Pending). Answers: "RTS rate this week?",
// "anong store yung pinakamataas na return?".
export async function getJtDeliveryStats(
  input: {
    date_from?: string;
    date_to?: string;
    since_days?: number;
    store_name?: string;
  },
  ctx: { supabase: SupabaseClient }
) {
  const since =
    input.date_from ?? isoDaysAgo(input.since_days ?? 30);
  const until = input.date_to ?? new Date().toISOString();

  let query = ctx.supabase
    .from("jt_deliveries")
    .select(
      "waybill, classification, store_name, cod_amount, shipping_cost, item_value, submission_date, signing_time, province, rts_reason"
    )
    .gte("submission_date", since)
    .lte("submission_date", until);

  if (input.store_name) query = query.eq("store_name", input.store_name);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const byClass = new Map<string, number>();
  const byStore = new Map<
    string,
    {
      total: number;
      delivered: number;
      returned: number;
      for_return: number;
      in_transit: number;
      cod_value: number;
      returned_cod_value: number;
    }
  >();
  const rtsReasons = new Map<string, number>();

  for (const r of rows) {
    byClass.set(r.classification, (byClass.get(r.classification) ?? 0) + 1);
    const store = r.store_name || "(unknown)";
    const existing =
      byStore.get(store) ?? {
        total: 0,
        delivered: 0,
        returned: 0,
        for_return: 0,
        in_transit: 0,
        cod_value: 0,
        returned_cod_value: 0,
      };
    existing.total += 1;
    existing.cod_value += Number(r.cod_amount ?? 0);
    if (r.classification === "Delivered") existing.delivered += 1;
    if (
      r.classification === "Returned" ||
      r.classification === "Returned (Aged)"
    ) {
      existing.returned += 1;
      existing.returned_cod_value += Number(r.cod_amount ?? 0);
    }
    if (r.classification === "For Return") existing.for_return += 1;
    if (r.classification === "In Transit") existing.in_transit += 1;
    byStore.set(store, existing);

    if (r.rts_reason) {
      rtsReasons.set(r.rts_reason, (rtsReasons.get(r.rts_reason) ?? 0) + 1);
    }
  }

  const total = rows.length;
  const delivered = byClass.get("Delivered") ?? 0;
  const returned =
    (byClass.get("Returned") ?? 0) + (byClass.get("Returned (Aged)") ?? 0);
  const rtsRate = total > 0 ? (returned / total) * 100 : 0;
  const deliveredRate = total > 0 ? (delivered / total) * 100 : 0;

  return {
    date_range: { from: since, to: until },
    total_shipments: total,
    delivered_rate_pct: Number(deliveredRate.toFixed(1)),
    rts_rate_pct: Number(rtsRate.toFixed(1)),
    by_classification: Object.fromEntries(byClass),
    by_store: Object.fromEntries(
      [...byStore.entries()].map(([store, stats]) => [
        store,
        {
          ...stats,
          rts_rate_pct: stats.total
            ? Number(((stats.returned / stats.total) * 100).toFixed(1))
            : 0,
        },
      ])
    ),
    top_rts_reasons: [...rtsReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
  };
}

// ─── get_pickpack_stats ───────────────────────────────────────────────
// Throughput + mismatch rate from pack_verifications. Answers:
// "who's slowest sa pick-pack?", "ilan packs ngayong araw?".
export async function getPickpackStats(
  input: {
    since_days?: number;
    date_from?: string;
    date_to?: string;
    employee_id?: string;
  },
  ctx: { supabase: SupabaseClient }
) {
  const since =
    input.date_from ?? isoDaysAgo(input.since_days ?? 7);
  const until = input.date_to ?? new Date().toISOString();

  let query = ctx.supabase
    .from("pack_verifications")
    .select(
      "id, order_number, status, items_expected, items_scanned, mismatches, verified_by, started_at, completed_at"
    )
    .gte("started_at", since)
    .lte("started_at", until);

  if (input.employee_id) query = query.eq("verified_by", input.employee_id);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const completed = rows.filter((r) => r.completed_at);
  const mismatches = rows.filter(
    (r) =>
      Array.isArray(r.mismatches) && (r.mismatches as unknown[]).length > 0
  );

  // Per-employee throughput
  const byEmployee = new Map<
    string,
    { packed: number; with_mismatch: number; avg_duration_s: number; total_duration_s: number }
  >();
  for (const r of completed) {
    const key = (r.verified_by as string | null) ?? "(unassigned)";
    const dur =
      r.completed_at && r.started_at
        ? (new Date(r.completed_at as string).getTime() -
            new Date(r.started_at as string).getTime()) /
          1000
        : 0;
    const existing =
      byEmployee.get(key) ?? {
        packed: 0,
        with_mismatch: 0,
        avg_duration_s: 0,
        total_duration_s: 0,
      };
    existing.packed += 1;
    existing.total_duration_s += dur;
    if (Array.isArray(r.mismatches) && (r.mismatches as unknown[]).length > 0) {
      existing.with_mismatch += 1;
    }
    byEmployee.set(key, existing);
  }
  for (const stats of byEmployee.values()) {
    stats.avg_duration_s = stats.packed
      ? Number((stats.total_duration_s / stats.packed).toFixed(1))
      : 0;
  }

  return {
    date_range: { from: since, to: until },
    total_started: rows.length,
    total_completed: completed.length,
    mismatch_count: mismatches.length,
    mismatch_rate_pct:
      rows.length > 0
        ? Number(((mismatches.length / rows.length) * 100).toFixed(1))
        : 0,
    by_employee: Object.fromEntries(byEmployee),
  };
}

// ─── get_waybill_mismatches ───────────────────────────────────────────
// Quality check: packer selected a sender name that didn't match the
// order's Shopify store. Critical audit trail — a bunch of these means
// the pack team is grabbing the wrong J&T waybill books.
export async function getWaybillMismatches(
  input: { since_days?: number; date_from?: string; date_to?: string },
  ctx: { supabase: SupabaseClient }
) {
  const since = input.date_from ?? isoDaysAgo(input.since_days ?? 7);
  const until = input.date_to ?? new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from("waybill_sender_audits")
    .select(
      "id, order_number, waybill, expected_store, actual_sender, is_mismatch, packed_by, packed_at"
    )
    .gte("packed_at", since)
    .lte("packed_at", until)
    .eq("is_mismatch", true)
    .order("packed_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const byPair = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.expected_store} → ${r.actual_sender}`;
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
  }

  return {
    date_range: { from: since, to: until },
    total_mismatches: rows.length,
    top_pairs: [...byPair.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, count]) => ({ pair, count })),
    mismatches: rows.slice(0, 50).map((r) => ({
      order_number: r.order_number,
      waybill: r.waybill,
      expected: r.expected_store,
      actual: r.actual_sender,
      packed_at: r.packed_at,
    })),
  };
}
