import { createServiceClient } from "@/lib/supabase/service";
import { computeAllKpis } from "@/lib/kpi/compute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Computes all KPI snapshots for `asOfDate` (defaults to today, PHT) and
// upserts them into `kpi_daily_snapshots`. Read by the admin KPI dashboard.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("date") ?? phtToday();

  const supabase = createServiceClient();
  const startTime = Date.now();

  try {
    const result = await computeAllKpis(supabase, asOfDate);
    return Response.json({
      success: true,
      as_of_date: asOfDate,
      computed: result.computed,
      upserted: result.upserted,
      errors: result.errors,
      duration_seconds: Math.round((Date.now() - startTime) / 1000),
    });
  } catch (err) {
    return Response.json(
      {
        error: "compute-kpis failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}

function phtToday(): string {
  // PHT = UTC+8. Use UTC math then offset.
  const now = new Date();
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}
