import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Returns fulfillment team-specific numbers: pack queue size, today's
// verified count (personal + team), and SKUs at low-stock runway risk.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const cookie = request.headers.get("cookie") ?? "";

  // Pack queue: unfulfilled orders with waybills (ready to verify)
  let packQueueSize = 0;
  try {
    const fulfillRes = await fetch(`${baseUrl}/api/shopify/fulfillment`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (fulfillRes.ok) {
      const data = (await fulfillRes.json()) as {
        orders?: { tracking_number?: string | null }[];
      };
      packQueueSize = (data.orders ?? []).filter((o) => o.tracking_number).length;
    }
  } catch {
    // ignore
  }

  // Today's verifications (UTC day — close enough for a dashboard)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { count: teamVerifiedToday } = await supabase
    .from("pack_verifications")
    .select("*", { count: "exact", head: true })
    .eq("status", "verified")
    .gte("completed_at", todayIso);

  const { count: myVerifiedToday } = await supabase
    .from("pack_verifications")
    .select("*", { count: "exact", head: true })
    .eq("status", "verified")
    .eq("verified_by", employee.id)
    .gte("completed_at", todayIso);

  // Low runway SKUs (piggyback on inventory_snapshots)
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: todaySnapshots } = await supabase
    .from("inventory_snapshots")
    .select("store_name, sku, variant_id, product_title, stock")
    .eq("snapshot_date", today);

  const { data: weekAgoSnapshots } = await supabase
    .from("inventory_snapshots")
    .select("store_name, sku, variant_id, stock")
    .eq("snapshot_date", weekAgo);

  interface TodaySnap {
    store_name: string;
    sku: string | null;
    variant_id: string | null;
    product_title: string | null;
    stock: number;
  }
  interface WeekAgoSnap {
    store_name: string;
    sku: string | null;
    variant_id: string | null;
    stock: number;
  }
  const todayMap = new Map<string, TodaySnap>();
  for (const row of (todaySnapshots ?? []) as TodaySnap[]) {
    todayMap.set(`${row.store_name}|${row.sku ?? ""}|${row.variant_id ?? ""}`, row);
  }
  const weekAgoMap = new Map<string, WeekAgoSnap>();
  for (const row of (weekAgoSnapshots ?? []) as WeekAgoSnap[]) {
    weekAgoMap.set(`${row.store_name}|${row.sku ?? ""}|${row.variant_id ?? ""}`, row);
  }

  const lowRunway: Array<{
    product_title: string;
    sku: string | null;
    stock: number;
    runway_days: number;
    velocity_per_day: number;
    store_name: string;
  }> = [];
  for (const [key, todayRow] of todayMap.entries()) {
    const weekAgoRow = weekAgoMap.get(key);
    if (!weekAgoRow) continue;
    const velocityPerWeek = weekAgoRow.stock - todayRow.stock;
    if (velocityPerWeek < 7) continue;
    const velocityPerDay = velocityPerWeek / 7;
    const runwayDays = todayRow.stock / velocityPerDay;
    if (runwayDays >= 7 || todayRow.stock <= 0) continue;
    lowRunway.push({
      product_title: todayRow.product_title ?? todayRow.sku ?? "Unknown",
      sku: todayRow.sku,
      stock: todayRow.stock,
      runway_days: Number(runwayDays.toFixed(1)),
      velocity_per_day: Number(velocityPerDay.toFixed(1)),
      store_name: todayRow.store_name,
    });
  }
  lowRunway.sort((a, b) => a.runway_days - b.runway_days);

  return Response.json({
    pack_queue: packQueueSize,
    my_verified_today: myVerifiedToday ?? 0,
    team_verified_today: teamVerifiedToday ?? 0,
    low_runway_skus: lowRunway.slice(0, 5),
  });
}
