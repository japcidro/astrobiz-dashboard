import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { insertAlert } from "@/lib/alerts/insert";

export const dynamic = "force-dynamic";

// POST /api/inventory/rts-batches/[id]/close — seal the batch and notify admin
export async function POST(
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

  const { data: batch, error: fetchErr } = await supabase
    .from("rts_batches")
    .select("*, shopify_stores!inner(name)")
    .eq("id", id)
    .single();

  if (fetchErr || !batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }

  const batchTyped = batch as {
    id: string;
    batch_ref: string;
    status: string;
    opened_by: string;
    item_count: number;
    unit_count: number;
    notes: string | null;
    shopify_stores: { name: string };
  };

  if (employee.role !== "admin" && batchTyped.opened_by !== employee.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (batchTyped.status === "closed") {
    return Response.json({ error: "Batch already closed" }, { status: 400 });
  }

  // Recompute counters from inventory_adjustments to be safe (cached
  // counters could be stale if a scan failed mid-flight).
  const { data: scans } = await supabase
    .from("inventory_adjustments")
    .select("sku, change_qty")
    .eq("rts_batch_id", id);

  const skuSet = new Set<string>();
  let unitTotal = 0;
  for (const s of scans ?? []) {
    if (s.sku) skuSet.add(s.sku as string);
    unitTotal += (s.change_qty as number) || 0;
  }

  const itemCount = skuSet.size;
  const unitCount = unitTotal;

  const { error: updateErr } = await supabase
    .from("rts_batches")
    .update({
      status: "closed",
      closed_by: employee.id,
      closed_at: new Date().toISOString(),
      item_count: itemCount,
      unit_count: unitCount,
    })
    .eq("id", id);

  if (updateErr) {
    return Response.json({ error: updateErr.message }, { status: 500 });
  }

  // Fire ONE summary alert for the whole batch (per-scan alerts were
  // suppressed by inventory-adjust when rts_batch_id was set).
  if (employee.role !== "admin") {
    await insertAlert(supabase, {
      type: "stock_added_by_team",
      severity: "info",
      title: `RTS batch closed: ${batchTyped.batch_ref} (+${unitCount} units)`,
      body:
        `${employee.full_name} closed RTS batch "${batchTyped.batch_ref}" ` +
        `for ${batchTyped.shopify_stores.name}. ` +
        `${itemCount} unique SKU(s), ${unitCount} unit(s) returned to stock.` +
        (batchTyped.notes ? ` Notes: ${batchTyped.notes}` : ""),
      resource_type: "store",
      resource_id: id,
      action_url: `/fulfillment/pick-pack/audit`,
      payload: {
        rts_batch_id: id,
        batch_ref: batchTyped.batch_ref,
        store_name: batchTyped.shopify_stores.name,
        item_count: itemCount,
        unit_count: unitCount,
        notes: batchTyped.notes,
        closed_by: employee.id,
        closed_by_name: employee.full_name,
        closed_by_role: employee.role,
      },
      dedup_hours: 0,
    });
  }

  return Response.json({
    ok: true,
    batch_id: id,
    item_count: itemCount,
    unit_count: unitCount,
  });
}
