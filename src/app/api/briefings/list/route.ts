import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type"); // morning | evening | weekly | monthly | null (all)
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 100);

  const supabase = await createClient();
  let query = supabase
    .from("briefings")
    .select(
      "id, type, period_label, period_start, period_end, headline, ai_summary, created_at, email_sent_at, fetch_errors, retry_count"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ briefings: data ?? [] });
}
