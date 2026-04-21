import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Lists past comparative analyses (admin + marketing scope via RLS).
// Returns full rows so opening a card from the list doesn't require a
// second fetch — analysis JSON + inputs_snapshot are both small enough
// (~5-30KB per row) that returning 20 of them is cheaper than two
// roundtrips per click.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    50
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_comparative_analyses")
    .select(
      "id, ad_ids, store_name, date_preset, analysis, inputs_snapshot, model, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ rows: data ?? [] });
}
