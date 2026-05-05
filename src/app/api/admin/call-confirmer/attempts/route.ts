import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  let query = supabase
    .from("call_attempts")
    .select(
      "id, store_id, shopify_order_id, shopify_order_name, customer_name, customer_phone, attempt_number, is_test_call, status, outcome, duration_seconds, cost_usd, ai_summary, customer_sentiment, needs_va_followup, handoff_reason, started_at, ended_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (storeId) query = query.eq("store_id", storeId);
  if (onlyTest) query = query.eq("is_test_call", true);
  else if (!includeTest) query = query.eq("is_test_call", false);
  if (status) query = query.eq("status", status);
  if (outcome) query = query.eq("outcome", outcome);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ attempts: data ?? [] });
}
