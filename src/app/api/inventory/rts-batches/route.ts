import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ExpectedItemInput {
  shopify_line_item_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  inventory_item_id?: number | null;
  expected_qty?: number;
}

interface CreateBatchBody {
  batch_ref?: string;
  store_id: string;
  notes?: string;
  // New waybill-first fields. All optional so the manual-fallback path
  // (lost label, J&T sync hasn't caught up) still works with batch_ref alone.
  waybill?: string | null;
  shopify_order_id?: string | null;
  shopify_order_name?: string | null;
  shopify_order_date?: string | null;
  lookup_source?: "jt_deliveries" | "shopify_tracking_map" | "manual_fallback" | null;
  expected_items?: ExpectedItemInput[];
}

// POST /api/inventory/rts-batches — open a new RTS batch
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateBatchBody;
  const storeId = body.store_id?.trim();
  const waybillRaw = body.waybill?.trim();
  const waybill = waybillRaw ? waybillRaw.toUpperCase() : null;
  // batch_ref defaults to the waybill so the legacy column stays populated
  // and the existing list views keep working without conditional rendering.
  const batchRef = body.batch_ref?.trim() || waybill || null;

  if (!storeId) {
    return Response.json({ error: "store_id is required" }, { status: 400 });
  }
  if (!batchRef) {
    return Response.json(
      { error: "Either waybill or batch_ref is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Verify store exists and is active
  const { data: store, error: storeErr } = await supabase
    .from("shopify_stores")
    .select("id, name")
    .eq("id", storeId)
    .eq("is_active", true)
    .single();

  if (storeErr || !store) {
    return Response.json({ error: "Store not found" }, { status: 404 });
  }

  // Waybill dedup. Two cases:
  //   - Existing OPEN batch → 409 with the existing batch id so the modal can
  //     resume it instead of double-opening.
  //   - Existing CLOSED batch → 409 with status='closed'. Per CEO decision
  //     2026-04-26: VAs cannot reopen a processed waybill. Admin can manually
  //     flip status='open' in SQL/admin UI, which then frees the partial
  //     unique index for fresh inserts.
  if (waybill) {
    const { data: dup } = await supabase
      .from("rts_batches")
      .select("id, status, opened_by, opened_at, closed_at")
      .eq("waybill", waybill)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dup) {
      if (dup.status === "open") {
        return Response.json(
          {
            error: "batch_already_open",
            existing_batch: dup,
          },
          { status: 409 }
        );
      }
      if (employee.role !== "admin") {
        return Response.json(
          {
            error: "batch_already_closed",
            existing_batch: dup,
          },
          { status: 409 }
        );
      }
      // Admin override falls through and creates a new batch.
    }
  }

  const insertPayload: Record<string, unknown> = {
    batch_ref: batchRef,
    store_id: storeId,
    notes: body.notes?.trim() || null,
    opened_by: employee.id,
    waybill,
    shopify_order_id: body.shopify_order_id?.trim() || null,
    shopify_order_name: body.shopify_order_name?.trim() || null,
    shopify_order_date: body.shopify_order_date || null,
    lookup_source: body.lookup_source || (waybill ? null : "manual_fallback"),
  };

  const { data, error } = await supabase
    .from("rts_batches")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error || !data) {
    return Response.json(
      { error: error?.message || "Failed to create batch" },
      { status: 500 }
    );
  }

  // Seed rts_batch_items from the resolved Shopify line items. Skipped on the
  // manual-fallback path (no expected_items provided) — that flow stays free-scan.
  const seededItems = (body.expected_items ?? []).filter(
    (it) => typeof it.expected_qty === "number" && it.expected_qty > 0
  );
  if (seededItems.length > 0) {
    const itemRows = seededItems.map((it) => ({
      rts_batch_id: data.id,
      shopify_line_item_id: it.shopify_line_item_id || null,
      sku: it.sku || null,
      barcode: it.barcode || null,
      product_title: it.product_title || null,
      variant_title: it.variant_title || null,
      inventory_item_id: it.inventory_item_id ?? null,
      expected_qty: it.expected_qty,
    }));
    const { error: itemsErr } = await supabase
      .from("rts_batch_items")
      .insert(itemRows);
    if (itemsErr) {
      // Roll back the batch so we don't leak an empty parent row that the
      // resume flow would later mis-resume against an empty checklist.
      await supabase.from("rts_batches").delete().eq("id", data.id);
      return Response.json(
        { error: `Failed to seed items: ${itemsErr.message}` },
        { status: 500 }
      );
    }
  }

  return Response.json({
    batch: { ...data, store_name: store.name },
  });
}

// GET /api/inventory/rts-batches?status=open|closed|all&limit=50
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50", 10),
    200
  );

  const supabase = await createClient();
  let query = supabase
    .from("rts_batches")
    .select(
      `
      *,
      shopify_stores!inner(name),
      opened_by_employee:employees!rts_batches_opened_by_fkey(full_name),
      closed_by_employee:employees!rts_batches_closed_by_fkey(full_name)
    `
    )
    .order("opened_at", { ascending: false })
    .limit(limit);

  if (status === "open" || status === "closed") {
    query = query.eq("status", status);
  }

  // Fulfillment users see all batches so hand-off works (CEO decision
  // 2026-04-26). Per-batch performed_by + opened_by/closed_by still scope
  // the audit trail.

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    [key: string]: unknown;
    shopify_stores?: { name: string } | null;
    opened_by_employee?: { full_name: string } | null;
    closed_by_employee?: { full_name: string } | null;
  };

  const batches = (data ?? []).map((row) => {
    const r = row as Row;
    return {
      ...r,
      store_name: r.shopify_stores?.name ?? null,
      opened_by_name: r.opened_by_employee?.full_name ?? null,
      closed_by_name: r.closed_by_employee?.full_name ?? null,
      shopify_stores: undefined,
      opened_by_employee: undefined,
      closed_by_employee: undefined,
    };
  });

  return Response.json({ batches });
}
