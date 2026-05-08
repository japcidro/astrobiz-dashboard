import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { computeAllKpis } from "@/lib/kpi/compute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Admin-only on-demand KPI recompute (no CRON_SECRET required).
// Useful right after logging stock counts or packing errors so the
// dashboard reflects the new data immediately.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("date") ?? phtToday();
  const supabase = createServiceClient();

  const result = await computeAllKpis(supabase, asOfDate);
  return Response.json({
    success: true,
    as_of_date: asOfDate,
    ...result,
  });
}

function phtToday(): string {
  const now = new Date();
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}
