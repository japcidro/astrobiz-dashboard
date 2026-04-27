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
    waybill: string | null;
    shopify_order_name: string | null;
    status: string;
    opened_by: string;
    item_count: number;
    unit_count: number;
    notes: string | null;
    shopify_stores: { name: string };
  };

  // Hand-off allowed: any fulfillment user can close a batch they didn't
  // open (CEO decision 2026-04-26).
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

  // Damaged + missing tallies from the seeded checklist (waybill-first batches).
  // Manual-fallback batches have no rts_batch_items rows so both stay 0.
  const { data: itemsRows } = await supabase
    .from("rts_batch_items")
    .select("expected_qty, received_qty, damaged_qty")
    .eq("rts_batch_id", id);

  let damagedTotal = 0;
  let missingTotal = 0;
  for (const it of itemsRows ?? []) {
    const expected = (it.expected_qty as number) ?? 0;
    const received = (it.received_qty as number) ?? 0;
    const damaged = (it.damaged_qty as number) ?? 0;
    damagedTotal += damaged;
    missingTotal += Math.max(expected - received - damaged, 0);
  }

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

  // Only fire an alert for exceptions (damaged/missing items). Normal
  // closures are aggregated into the morning/evening briefings to avoid
  // notification spam.
  if (employee.role !== "admin" && (damagedTotal > 0 || missingTotal > 0)) {
    const orderTag = batchTyped.shopify_order_name
      ? ` for ${batchTyped.shopify_order_name}`
      : "";
    const damagedText = damagedTotal > 0 ? `, ${damagedTotal} damaged` : "";
    const missingText = missingTotal > 0 ? `, ${missingTotal} missing` : "";
    await insertAlert(supabase, {
      type: "stock_added_by_team",
      severity: "action",
      title: `RTS exception: ${batchTyped.waybill || batchTyped.batch_ref} (+${unitCount} units${damagedText}${missingText})`,
      body:
        `${employee.full_name} closed RTS batch "${batchTyped.waybill || batchTyped.batch_ref}"${orderTag} ` +
        `for ${batchTyped.shopify_stores.name}. ` +
        `${unitCount} unit(s) returned to stock${damagedText}${missingText}.` +
        (batchTyped.notes ? ` Notes: ${batchTyped.notes}` : ""),
      resource_type: "store",
      resource_id: id,
      action_url: `/fulfillment/pick-pack/audit`,
      payload: {
        rts_batch_id: id,
        waybill: batchTyped.waybill,
        batch_ref: batchTyped.batch_ref,
        shopify_order_name: batchTyped.shopify_order_name,
        store_name: batchTyped.shopify_stores.name,
        item_count: itemCount,
        unit_count: unitCount,
        damaged_count: damagedTotal,
        missing_count: missingTotal,
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
    damaged_count: damagedTotal,
    missing_count: missingTotal,
  });
}
