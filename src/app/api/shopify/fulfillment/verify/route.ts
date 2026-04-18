import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    store_id?: string;
    store_name?: string;
    order_id?: string | number;
    order_number?: string;
    items_expected?: number;
    items_scanned?: number;
    mismatches?: unknown;
    started_at?: string;
  };

  const store_id = (body.store_id ?? "").toString();
  const order_id = body.order_id != null ? String(body.order_id) : "";
  const order_number = (body.order_number ?? "").toString();

  if (!store_id || !order_id || !order_number) {
    return Response.json(
      { error: "store_id, order_id, and order_number are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const mismatches = Array.isArray(body.mismatches) ? body.mismatches : [];
  const hasMismatches = mismatches.length > 0;
  const status = hasMismatches ? "mismatch_corrected" : "verified";
  const now = new Date().toISOString();
  const startedAt = body.started_at ?? now;

  // Manual check-then-insert-or-update. Avoids depending on a DB-level
  // UNIQUE constraint, which the original migration did not add.
  const { data: existing, error: findError } = await supabase
    .from("pack_verifications")
    .select("id")
    .eq("store_id", store_id)
    .eq("order_id", order_id)
    .maybeSingle();

  if (findError) {
    console.error("[verify] Lookup failed:", findError);
    return Response.json(
      { error: findError.message, code: findError.code, hint: findError.hint },
      { status: 500 }
    );
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("pack_verifications")
      .update({
        order_number,
        status,
        items_expected: body.items_expected ?? 0,
        items_scanned: body.items_scanned ?? 0,
        mismatches,
        verified_by: employee.id,
        started_at: startedAt,
        completed_at: now,
      })
      .eq("id", existing.id);

    if (updateError) {
      console.error("[verify] Update failed:", updateError);
      return Response.json(
        { error: updateError.message, code: updateError.code, hint: updateError.hint },
        { status: 500 }
      );
    }

    return Response.json({ success: true, id: existing.id });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("pack_verifications")
    .insert({
      store_id,
      order_id,
      order_number,
      status,
      items_expected: body.items_expected ?? 0,
      items_scanned: body.items_scanned ?? 0,
      mismatches,
      verified_by: employee.id,
      started_at: startedAt,
      completed_at: now,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[verify] Insert failed:", insertError);
    return Response.json(
      { error: insertError.message, code: insertError.code, hint: insertError.hint },
      { status: 500 }
    );
  }

  return Response.json({ success: true, id: inserted?.id });
}
