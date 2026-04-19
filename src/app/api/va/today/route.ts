import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ShopifyOrder {
  store_name: string;
  fulfillment_status: string | null;
  age_days: number;
  cancelled_at: string | null;
}

// Returns per-store order breakdown for VA's dashboard. Uses today's orders.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "va", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const cookie = request.headers.get("cookie") ?? "";

  const res = await fetch(
    `${baseUrl}/api/shopify/orders?date_filter=today&store=ALL`,
    { headers: { cookie }, cache: "no-store" }
  );
  if (!res.ok) return Response.json({ stores: [] });

  const data = (await res.json()) as { orders?: ShopifyOrder[] };
  const orders = data.orders ?? [];

  const byStore = new Map<
    string,
    { total: number; unfulfilled: number; aging: number; fulfilled: number }
  >();

  for (const order of orders) {
    if (order.cancelled_at) continue;
    const key = order.store_name || "Unknown";
    const agg = byStore.get(key) ?? {
      total: 0,
      unfulfilled: 0,
      aging: 0,
      fulfilled: 0,
    };
    agg.total++;
    if (!order.fulfillment_status) agg.unfulfilled++;
    if (order.fulfillment_status === "fulfilled") agg.fulfilled++;
    if (!order.fulfillment_status && order.age_days >= 3) agg.aging++;
    byStore.set(key, agg);
  }

  const stores = Array.from(byStore.entries())
    .map(([name, agg]) => ({ store_name: name, ...agg }))
    .sort((a, b) => b.unfulfilled - a.unfulfilled);

  return Response.json({ stores });
}
