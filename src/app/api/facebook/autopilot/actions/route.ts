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
  const limitRaw = parseInt(searchParams.get("limit") || "100", 10);
  const limit = Math.min(Math.max(limitRaw || 100, 1), 500);
  const filter = searchParams.get("filter"); // 'paused' | 'resumed' | 'error' | null

  const supabase = await createClient();

  let query = supabase
    .from("autopilot_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filter === "paused") query = query.eq("action", "paused");
  else if (filter === "resumed") query = query.eq("action", "resumed");
  else if (filter === "error") query = query.eq("status", "error");

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ actions: data ?? [] });
}
