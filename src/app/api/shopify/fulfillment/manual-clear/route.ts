import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const MAX_ORDERS_PER_REQUEST = 250;

const REASON_CODES = new Set([
  "catching_up_backlog",
  "already_packed_offline",
  "system_error_manual_fulfill",
  "other",
]);

interface ClearOrderInput {
  store_id: string;
  order_id: string | number;
  order_number: string;
  items_expected?: number;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    orders?: ClearOrderInput[];
    reason_code?: string;
    note?: string;
  };

  const orders = Array.isArray(body.orders) ? body.orders : [];
  const reason_code = (body.reason_code ?? "").trim();
  const note = (body.note ?? "").trim();

  if (orders.length === 0) {
    return Response.json(
      { error: "No orders provided" },
      { status: 400 }
    );
  }
  if (orders.length > MAX_ORDERS_PER_REQUEST) {
    return Response.json(
      {
        error: `Too many orders in one request (max ${MAX_ORDERS_PER_REQUEST}). Split into batches.`,
      },
      { status: 400 }
    );
  }
  if (!REASON_CODES.has(reason_code)) {
    return Response.json(
      { error: "Invalid reason_code" },
      { status: 400 }
    );
  }
  if (reason_code === "other" && note.length < 5) {
    return Response.json(
      { error: 'A note (min 5 chars) is required when reason is "other"' },
      { status: 400 }
    );
  }

  for (const o of orders) {
    if (!o.store_id || o.order_id == null || !o.order_number) {
      return Response.json(
        {
          error:
            "Each order must include store_id, order_id, and order_number",
        },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const notes = note ? `${reason_code}: ${note}` : reason_code;

  const rows = orders.map((o) => ({
    store_id: String(o.store_id),
    order_id: String(o.order_id),
    order_number: String(o.order_number),
    status: "manual_cleared",
    source: "manual_clear",
    items_expected: o.items_expected ?? 0,
    items_scanned: 0,
    mismatches: [],
    notes,
    verified_by: employee.id,
    started_at: now,
    completed_at: now,
  }));

  // Upsert on (store_id, order_id). If an order was already verified by scan,
  // we deliberately skip overwriting — real scan data wins over a manual clear.
  // Postgres `on conflict do nothing` via upsert with ignoreDuplicates.
  const { data: inserted, error } = await supabase
    .from("pack_verifications")
    .upsert(rows, {
      onConflict: "store_id,order_id",
      ignoreDuplicates: true,
    })
    .select("id, order_id");

  if (error) {
    console.error(
      `[manual-clear] Insert failed (employee=${employee.id}):`,
      error
    );
    return Response.json(
      {
        error: error.message,
        code: error.code,
        hint: error.hint,
      },
      { status: 500 }
    );
  }

  const clearedCount = inserted?.length ?? 0;
  const skippedCount = orders.length - clearedCount;

  console.info(
    `[manual-clear] employee=${employee.id} (${employee.full_name}) reason=${reason_code} cleared=${clearedCount} skipped=${skippedCount} total=${orders.length}`
  );

  return Response.json({
    success: true,
    cleared: clearedCount,
    skipped: skippedCount,
    total: orders.length,
  });
}
