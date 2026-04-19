import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("ad_id");
  const accountId = searchParams.get("account_id");
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "50", 10) || 50,
    200
  );

  const supabase = await createClient();

  // Single-ad lookup — used by the ads page "Analyze" panel.
  if (adId) {
    const { data, error } = await supabase
      .from("ad_creative_analyses")
      .select("*")
      .eq("ad_id", adId)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ row: data ?? null });
  }

  // List mode — used by the Deconstruction tab.
  let query = supabase
    .from("ad_creative_analyses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (accountId) query = query.eq("account_id", accountId);

  const { data: rows, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Enrich with employee names for display.
  const employeeIds = [
    ...new Set((rows ?? []).map((r) => r.analyzed_by).filter(Boolean)),
  ];
  let nameMap = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", employeeIds);
    nameMap = new Map(
      (emps ?? []).map((e) => [e.id as string, e.full_name as string])
    );
  }

  const enriched = (rows ?? []).map((r) => ({
    ...r,
    analyzed_by_name: r.analyzed_by ? (nameMap.get(r.analyzed_by) ?? null) : null,
  }));

  return Response.json({ rows: enriched });
}
