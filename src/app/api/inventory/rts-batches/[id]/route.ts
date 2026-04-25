import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET /api/inventory/rts-batches/[id] — batch + per-SKU scan summary
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: batch, error: batchErr } = await supabase
    .from("rts_batches")
    .select(
      `
      *,
      shopify_stores!inner(name),
      opened_by_employee:employees!rts_batches_opened_by_fkey(full_name),
      closed_by_employee:employees!rts_batches_closed_by_fkey(full_name)
    `
    )
    .eq("id", id)
    .single();

  if (batchErr || !batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }

  // Non-admins can only view their own batches.
  const batchTyped = batch as { opened_by: string };
  if (employee.role !== "admin" && batchTyped.opened_by !== employee.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: adjustments, error: adjErr } = await supabase
    .from("inventory_adjustments")
    .select("sku, product_title, change_qty, created_at")
    .eq("rts_batch_id", id)
    .order("created_at", { ascending: false });

  if (adjErr) {
    return Response.json({ error: adjErr.message }, { status: 500 });
  }

  // Aggregate per-SKU
  const scanMap = new Map<
    string,
    { sku: string; product_title: string | null; count: number; last_scanned_at: string }
  >();
  for (const adj of adjustments ?? []) {
    const sku = (adj.sku as string) || "(no sku)";
    const change = (adj.change_qty as number) || 0;
    const existing = scanMap.get(sku);
    if (existing) {
      existing.count += change;
    } else {
      scanMap.set(sku, {
        sku,
        product_title: (adj.product_title as string) ?? null,
        count: change,
        last_scanned_at: adj.created_at as string,
      });
    }
  }

  const row = batch as {
    [key: string]: unknown;
    shopify_stores?: { name: string } | null;
    opened_by_employee?: { full_name: string } | null;
    closed_by_employee?: { full_name: string } | null;
  };

  return Response.json({
    batch: {
      ...row,
      store_name: row.shopify_stores?.name ?? null,
      opened_by_name: row.opened_by_employee?.full_name ?? null,
      closed_by_name: row.closed_by_employee?.full_name ?? null,
      shopify_stores: undefined,
      opened_by_employee: undefined,
      closed_by_employee: undefined,
      scans: Array.from(scanMap.values()),
    },
  });
}
