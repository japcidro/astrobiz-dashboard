import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface CountEntry {
  sku: string;
  expected_qty: number;
  actual_qty: number;
  notes?: string;
}

interface PostBody {
  week_starting: string; // YYYY-MM-DD (Monday)
  entries: CountEntry[];
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as PostBody;
  if (!body.week_starting || !Array.isArray(body.entries) || body.entries.length === 0) {
    return Response.json({ error: "week_starting and entries[] required" }, { status: 400 });
  }

  const supabase = await createClient();
  const records = body.entries
    .filter((e) => e.sku && Number.isFinite(e.expected_qty) && Number.isFinite(e.actual_qty))
    .map((e) => ({
      week_starting: body.week_starting,
      sku: e.sku,
      expected_qty: Math.round(e.expected_qty),
      actual_qty: Math.round(e.actual_qty),
      counted_by: employee.id,
      counted_at: new Date().toISOString(),
      notes: e.notes ?? null,
    }));

  if (records.length === 0) {
    return Response.json({ error: "No valid entries" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("stock_counts")
    .upsert(records, { onConflict: "week_starting,sku", count: "exact" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, saved: count ?? records.length });
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  const url = new URL(request.url);
  const weekStarting = url.searchParams.get("week_starting") ?? mondayOfThisWeek();

  // Watchlist + latest snapshot stock (inventory_snapshots) per SKU + already-counted values
  const [{ data: watchlist }, { data: counted }] = await Promise.all([
    supabase
      .from("stock_count_watchlist")
      .select("sku, product_name, is_active")
      .eq("is_active", true)
      .order("sku"),
    supabase
      .from("stock_counts")
      .select("sku, expected_qty, actual_qty, notes")
      .eq("week_starting", weekStarting),
  ]);

  const watchSkus = (watchlist ?? []).map((w) => w.sku);
  let latestStock: Record<string, number> = {};
  if (watchSkus.length) {
    // Latest snapshot stock per SKU from inventory_snapshots
    const { data: snaps } = await supabase
      .from("inventory_snapshots")
      .select("sku, stock, snapshot_date")
      .in("sku", watchSkus)
      .order("snapshot_date", { ascending: false })
      .limit(2000);
    const seen = new Set<string>();
    for (const s of snaps ?? []) {
      if (s.sku && !seen.has(s.sku)) {
        seen.add(s.sku);
        latestStock[s.sku] = Number(s.stock) || 0;
      }
    }
  }

  const countedMap = new Map((counted ?? []).map((c) => [c.sku, c]));

  return Response.json({
    week_starting: weekStarting,
    rows: (watchlist ?? []).map((w) => ({
      sku: w.sku,
      product_name: w.product_name,
      expected_qty: latestStock[w.sku] ?? 0,
      already_counted: countedMap.get(w.sku) ?? null,
    })),
  });
}

function mondayOfThisWeek(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0..6
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(now.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}
