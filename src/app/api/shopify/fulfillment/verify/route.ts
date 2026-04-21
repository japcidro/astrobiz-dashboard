import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { insertAlert } from "@/lib/alerts/insert";

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
    waybill?: string;
    actual_sender?: string;
  };

  const store_id = (body.store_id ?? "").toString();
  const store_name = (body.store_name ?? "").toString();
  const order_id = body.order_id != null ? String(body.order_id) : "";
  const order_number = (body.order_number ?? "").toString();
  const waybill = (body.waybill ?? "").toString().trim() || null;
  const actualSender = (body.actual_sender ?? "").toString().trim();

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

    await logSenderAudit({
      supabase,
      employeeId: employee.id,
      store_name,
      actualSender,
      order_id,
      order_number,
      waybill,
    });

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

  await logSenderAudit({
    supabase,
    employeeId: employee.id,
    store_name,
    actualSender,
    order_id,
    order_number,
    waybill,
  });

  return Response.json({ success: true, id: inserted?.id });
}

async function logSenderAudit(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  employeeId: string;
  store_name: string;
  actualSender: string;
  order_id: string;
  order_number: string;
  waybill: string | null;
}) {
  const { supabase, employeeId, store_name, actualSender, order_id, order_number, waybill } = args;

  if (!store_name || !actualSender) return;

  const isMismatch = normalize(actualSender) !== normalize(store_name);

  const { error: auditError } = await supabase
    .from("waybill_sender_audits")
    .insert({
      order_id,
      order_number,
      waybill,
      expected_store: store_name,
      actual_sender: actualSender,
      is_mismatch: isMismatch,
      packed_by: employeeId,
    });

  if (auditError) {
    console.error("[verify] Sender audit insert failed:", auditError.message);
  }

  if (!isMismatch) return;

  await insertAlert(supabase, {
    type: "waybill_sender_mismatch",
    severity: "action",
    title: `Wrong sender on ${order_number || "order"} — expected ${store_name}, label says ${actualSender}`,
    body: [
      `Order: ${order_number || order_id}`,
      waybill ? `Waybill: ${waybill}` : null,
      `Expected: ${store_name}`,
      `Packer saw: ${actualSender}`,
    ]
      .filter(Boolean)
      .join("\n"),
    resource_type: "store",
    resource_id: waybill || order_id,
    payload: {
      order_id,
      order_number,
      waybill,
      expected_store: store_name,
      actual_sender: actualSender,
      packed_by: employeeId,
    },
    dedup_hours: 1,
  });
}

function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
