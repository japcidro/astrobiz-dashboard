import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface CreateBatchBody {
  batch_ref: string;
  store_id: string;
  notes?: string;
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
  const batchRef = body.batch_ref?.trim();
  const storeId = body.store_id?.trim();

  if (!batchRef) {
    return Response.json({ error: "batch_ref is required" }, { status: 400 });
  }
  if (!storeId) {
    return Response.json({ error: "store_id is required" }, { status: 400 });
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

  const { data, error } = await supabase
    .from("rts_batches")
    .insert({
      batch_ref: batchRef,
      store_id: storeId,
      notes: body.notes?.trim() || null,
      opened_by: employee.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return Response.json(
      { error: error?.message || "Failed to create batch" },
      { status: 500 }
    );
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

  // Fulfillment users only see their own batches; admin sees all.
  if (employee.role !== "admin") {
    query = query.eq("opened_by", employee.id);
  }

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
