import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const waybill = searchParams.get("waybill")?.trim();

  if (!waybill) {
    return Response.json({ error: "waybill is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jt_deliveries")
    .select("waybill, receiver, store_name, cod_amount, item_name")
    .eq("waybill", waybill)
    .single();

  if (error || !data) {
    return Response.json(
      { error: "Waybill not found", waybill },
      { status: 404 }
    );
  }

  return Response.json({
    waybill: data.waybill,
    receiver: data.receiver,
    store_name: data.store_name,
    cod_amount: data.cod_amount,
    item_name: data.item_name,
  });
}
