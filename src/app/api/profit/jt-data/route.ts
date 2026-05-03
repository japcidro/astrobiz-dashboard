import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

type JtDeliveryRow = {
  classification: string | null;
  cod_amount: number | string | null;
  shipping_cost: number | string | null;
  [key: string]: unknown;
};

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

  // PostgREST silently caps a bare select() at 1000 rows. The whole-table
  // J&T view easily exceeds that (table is ~2.5k+ and growing), which made
  // every summary count and the delivery/RTS rates wrong. Drain via the
  // paginate helper so the dashboard always sees everything.
  //
  // submission_date is stored as ISO timestamp ("2026-04-19T16:00:00.000Z")
  // but date_from / date_to come in as bare PHT calendar dates ("2026-04-19").
  // A naked lte against a longer ISO string returns FALSE for same-day rows
  // because lexicographically "2026-04-19T..." > "2026-04-19", which silently
  // dropped every row submitted on the end date. Anchor to PHT day boundaries.
  const { data: deliveries, error } = await fetchAllRows<JtDeliveryRow>(
    () => {
      let q = supabase.from("jt_deliveries").select("*");
      if (store !== "ALL") q = q.eq("store_name", store);
      if (dateFrom) q = q.gte("submission_date", `${dateFrom}T00:00:00+08:00`);
      if (dateTo) q = q.lte("submission_date", `${dateTo}T23:59:59+08:00`);
      if (classification !== "all") q = q.eq("classification", classification);
      return q;
    },
    { orderColumn: "submission_date", ascending: false }
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

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
      (sum, d) => sum + (parseFloat(String(d.cod_amount ?? 0)) || 0),
      0
    ),
    total_shipping: deliveries.reduce(
      (sum, d) => sum + (parseFloat(String(d.shipping_cost ?? 0)) || 0),
      0
    ),
  };

  return Response.json({ deliveries, summary });
}
