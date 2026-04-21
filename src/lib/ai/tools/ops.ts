// Operations tools — admin_alerts, employee_notifications.
// These surface "what needs attention?" info that spans domains
// (stock, RTS spikes, winners, etc.) without re-implementing per-domain
// logic. The dedup + email-sent tracking is already done by the
// insert_admin_alert RPC upstream; we just read.

import type { SupabaseClient } from "@supabase/supabase-js";

type AlertSeverity = "urgent" | "action" | "info";

// ─── get_stock_alerts ─────────────────────────────────────────────────
// Filters admin_alerts to stock-relevant types. Answers: "may winner ba
// ako naubusan ng stock?", "anong products na-restock lately?".
export async function getStockAlerts(
  input: { unread_only?: boolean; limit?: number },
  ctx: { supabase: SupabaseClient }
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  let query = ctx.supabase
    .from("admin_alerts")
    .select(
      "id, type, severity, title, body, resource_type, resource_id, action_url, payload, created_at, read_at"
    )
    .in("type", [
      "stock_depleting_winner",
      "stock_restocked_winner",
      "new_winner",
    ])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.unread_only) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const byType = new Map<string, number>();
  for (const a of rows) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);

  return {
    count: rows.length,
    by_type: Object.fromEntries(byType),
    alerts: rows.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity as AlertSeverity,
      title: a.title,
      body: a.body,
      product_or_sku: a.resource_id,
      action_url: a.action_url,
      created_at: a.created_at,
      unread: !a.read_at,
    })),
  };
}

// ─── get_recent_notifications ─────────────────────────────────────────
// Covers the full admin_alerts stream (not just stock). For marketing-
// only relevance we narrow to types that affect ad decisions. Admin
// gets the full set.
export async function getRecentNotifications(
  input: { unread_only?: boolean; limit?: number; role: "admin" | "marketing" },
  ctx: { supabase: SupabaseClient }
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  let query = ctx.supabase
    .from("admin_alerts")
    .select(
      "id, type, severity, title, body, resource_type, resource_id, action_url, payload, created_at, read_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  // Marketing sees only alerts relevant to their role — no RTS spikes
  // (that's fulfillment/CEO turf) and no cash_at_risk (that's CEO only).
  if (input.role === "marketing") {
    query = query.in("type", [
      "new_winner",
      "autopilot_big_action",
      "stock_restocked_winner",
      "stock_depleting_winner",
    ]);
  }
  if (input.unread_only) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const bySeverity = new Map<string, number>();
  for (const a of rows)
    bySeverity.set(a.severity, (bySeverity.get(a.severity) ?? 0) + 1);

  return {
    count: rows.length,
    by_severity: Object.fromEntries(bySeverity),
    notifications: rows.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity as AlertSeverity,
      title: a.title,
      body: a.body,
      action_url: a.action_url,
      created_at: a.created_at,
      unread: !a.read_at,
    })),
  };
}
