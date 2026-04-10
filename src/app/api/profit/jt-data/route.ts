import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store") || "ALL";
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const classification = searchParams.get("classification") || "all";

  const supabase = await createClient();

  let query = supabase.from("jt_deliveries").select("*");

  if (store !== "ALL") {
    query = query.eq("store_name", store);
  }

  if (dateFrom) {
    query = query.gte("submission_date", dateFrom);
  }

  if (dateTo) {
    query = query.lte("submission_date", dateTo);
  }

  if (classification !== "all") {
    query = query.eq("classification", classification);
  }

  query = query.order("submission_date", { ascending: false });

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const deliveries = data || [];

  // Compute summary
  const summary = {
    total: deliveries.length,
    delivered: deliveries.filter((d) => d.classification === "Delivered").length,
    returned: deliveries.filter((d) => d.classification === "Returned").length,
    in_transit: deliveries.filter((d) => d.classification === "In Transit")
      .length,
    for_return: deliveries.filter((d) => d.classification === "For Return")
      .length,
    aged: deliveries.filter((d) => d.classification === "Returned (Aged)")
      .length,
    pending: deliveries.filter((d) => d.classification === "Pending").length,
    total_cod: deliveries.reduce(
      (sum, d) => sum + (parseFloat(d.cod_amount) || 0),
      0
    ),
    total_shipping: deliveries.reduce(
      (sum, d) => sum + (parseFloat(d.shipping_cost) || 0),
      0
    ),
  };

  return Response.json({ deliveries, summary });
}
