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

  const body = await request.json();
  const { store_id, order_id, order_number, items_expected, items_scanned, mismatches } = body as {
    store_id: string;
    store_name: string;
    order_id: string;
    order_number: string;
    items_expected: number;
    items_scanned: number;
    mismatches: unknown;
  };

  if (!order_id || !order_number) {
    return Response.json({ error: "order_id and order_number are required" }, { status: 400 });
  }

  const supabase = await createClient();

  const hasMismatches = Array.isArray(mismatches) && mismatches.length > 0;

  const { data, error } = await supabase
    .from("pack_verifications")
    .upsert(
      {
        store_id: store_id || "",
        order_id,
        order_number,
        status: hasMismatches ? "mismatch_corrected" : "verified",
        items_expected: items_expected || 0,
        items_scanned: items_scanned || 0,
        mismatches: mismatches || [],
        verified_by: employee.id,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
      { onConflict: "order_id" }
    )
    .select("id")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, id: data?.id });
}
