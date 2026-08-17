import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { syncAttemptFromVapi } from "@/lib/call-confirmer/sync";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id, store_id, shopify_order_id, shopify_order_name, customer_name, customer_phone, attempt_number, is_test_call, status, outcome, duration_seconds, cost_usd, ai_summary, customer_sentiment, needs_va_followup, handoff_reason, address_confirmed, corrected_address, provider_call_id, started_at, ended_at, created_at";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "escalated",
]);

// Repairing a stuck row costs one Vapi round-trip each, so bound it. The rest
// heal on later loads as they scroll into the most-recent window.
const MAX_REPAIR_PER_REQUEST = 10;

export async function GET(req: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const storeId = url.searchParams.get("store_id");
  const includeTest = url.searchParams.get("include_test") !== "false"; // default true
  const onlyTest = url.searchParams.get("only_test") === "true";
  const status = url.searchParams.get("status");
  const outcome = url.searchParams.get("outcome");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
    500
  );

  const supabase = await createClient();

  const run = () => {
    let query = supabase
      .from("call_attempts")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (storeId) query = query.eq("store_id", storeId);
    if (onlyTest) query = query.eq("is_test_call", true);
    else if (!includeTest) query = query.eq("is_test_call", false);
    if (status) query = query.eq("status", status);
    if (outcome) query = query.eq("outcome", outcome);
    return query;
  };

  const { data, error } = await run();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Self-heal rows that never got a webhook. Without this a missed delivery
  // leaves an attempt showing "ringing" with no duration, outcome or cost —
  // permanently, since nothing else ever revisits it.
  const stuck = (data ?? [])
    .filter((a) => a.provider_call_id && !TERMINAL_STATUSES.has(a.status))
    .slice(0, MAX_REPAIR_PER_REQUEST);

  if (stuck.length > 0) {
    await Promise.all(
      stuck.map((a) =>
        syncAttemptFromVapi(a.id, a.provider_call_id as string).catch(() => {})
      )
    );
    const { data: refreshed } = await run();
    if (refreshed) return Response.json({ attempts: refreshed });
  }

  return Response.json({ attempts: data ?? [] });
}
