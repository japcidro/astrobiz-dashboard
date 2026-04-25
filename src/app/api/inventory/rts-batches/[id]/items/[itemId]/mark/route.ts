import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface MarkBody {
  damaged_qty?: number;
  notes?: string;
}

// POST /api/inventory/rts-batches/[id]/items/[itemId]/mark
// Updates the per-item damaged count and/or notes WITHOUT touching Shopify
// stock. Damaged units are scrap — counted + remembered, never restocked.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: batchId, itemId } = await params;
  const body = (await request.json()) as MarkBody;

  if (
    body.damaged_qty === undefined &&
    body.notes === undefined
  ) {
    return Response.json(
      { error: "damaged_qty or notes is required" },
      { status: 400 }
    );
  }
  if (
    body.damaged_qty !== undefined &&
    (typeof body.damaged_qty !== "number" || body.damaged_qty < 0)
  ) {
    return Response.json(
      { error: "damaged_qty must be a non-negative number" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("rts_batches")
    .select("id, status")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }
  if (batch.status !== "open") {
    return Response.json({ error: "Batch is closed" }, { status: 400 });
  }

  const { data: item } = await supabase
    .from("rts_batch_items")
    .select("id, rts_batch_id, expected_qty, received_qty, damaged_qty, notes")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.rts_batch_id !== batchId) {
    return Response.json(
      { error: "Item does not belong to this batch" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (body.damaged_qty !== undefined) update.damaged_qty = body.damaged_qty;
  if (body.notes !== undefined) update.notes = body.notes.trim() || null;

  const { data: updated, error: updateErr } = await supabase
    .from("rts_batch_items")
    .update(update)
    .eq("id", itemId)
    .select("id, expected_qty, received_qty, damaged_qty, notes")
    .single();

  if (updateErr || !updated) {
    return Response.json(
      { error: updateErr?.message || "Failed to update item" },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, item: updated });
}
