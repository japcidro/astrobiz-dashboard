import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET /api/inventory/rts-batches/[id]/items — seeded checklist + current state.
// Used by the modal to render the per-line scan progress and to resume an
// in-progress batch after a refresh / hand-off to another VA.
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
    .select("id, status, store_id, waybill, shopify_order_name")
    .eq("id", id)
    .maybeSingle();
  if (batchErr || !batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }

  const { data: items, error: itemsErr } = await supabase
    .from("rts_batch_items")
    .select(
      "id, shopify_line_item_id, sku, barcode, product_title, variant_title, inventory_item_id, expected_qty, received_qty, damaged_qty, notes"
    )
    .eq("rts_batch_id", id)
    .order("created_at", { ascending: true });
  if (itemsErr) {
    return Response.json({ error: itemsErr.message }, { status: 500 });
  }

  return Response.json({ batch, items: items ?? [] });
}
