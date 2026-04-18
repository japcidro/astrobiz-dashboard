import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const ALLOWED_SOURCES = new Set(["scan", "manual_clear", "backfill"]);

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "ALL";
  const search = (url.searchParams.get("q") ?? "").trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "200", 10) || 200,
    500
  );

  const supabase = await createClient();
  let query = supabase
    .from("pack_verifications")
    .select(
      "id, store_id, order_id, order_number, status, source, items_expected, items_scanned, mismatches, notes, verified_by, completed_at"
    )
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (source !== "ALL" && ALLOWED_SOURCES.has(source)) {
    query = query.eq("source", source);
  }
  if (from) query = query.gte("completed_at", from);
  if (to) query = query.lte("completed_at", to);
  if (search) {
    query = query.ilike("order_number", `%${search}%`);
  }

  const { data: verifications, error } = await query;
  if (error) {
    console.error("[verifications]", error);
    return Response.json(
      { error: error.message, code: error.code },
      { status: 500 }
    );
  }

  const rows = verifications ?? [];

  // Enrich with store + employee names
  const storeIds = [...new Set(rows.map((r) => r.store_id).filter(Boolean))];
  const employeeIds = [
    ...new Set(rows.map((r) => r.verified_by).filter(Boolean)),
  ];

  const [storesRes, employeesRes] = await Promise.all([
    storeIds.length
      ? supabase
          .from("shopify_stores")
          .select("id, name")
          .in("id", storeIds)
      : Promise.resolve({ data: [], error: null }),
    employeeIds.length
      ? supabase
          .from("employees")
          .select("id, full_name")
          .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const storeMap = new Map<string, string>();
  for (const s of (storesRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    storeMap.set(s.id, s.name);
  }
  const employeeMap = new Map<string, string>();
  for (const e of (employeesRes.data ?? []) as Array<{
    id: string;
    full_name: string;
  }>) {
    employeeMap.set(e.id, e.full_name);
  }

  const enriched = rows.map((r) => ({
    ...r,
    store_name: storeMap.get(r.store_id) ?? r.store_id,
    verified_by_name: r.verified_by ? (employeeMap.get(r.verified_by) ?? null) : null,
    mismatch_count: Array.isArray(r.mismatches) ? r.mismatches.length : 0,
  }));

  return Response.json({ rows: enriched });
}
