import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// vat_rate is a fraction of the supplier price (0.12 = 12%). Anything that
// is not a sane fraction is stored as 0 rather than silently as a discount
// or a 1200% surcharge.
function normalizeVatRate(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return 0;
  return Math.round(n * 10000) / 10000;
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");

  const supabase = await createClient();

  let query = supabase
    .from("cogs_items")
    .select("*")
    .order("store_name", { ascending: true })
    .order("sku", { ascending: true });

  if (store) {
    query = query.eq("store_name", store);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data || [] });
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const items: Array<{
    store_name: string;
    sku: string;
    product_name: string;
    cogs_per_unit: number;
    vat_rate?: number;
  }> = body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items array is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const rows = items.map((item) => ({
    store_name: item.store_name,
    sku: item.sku,
    product_name: item.product_name || null,
    cogs_per_unit: item.cogs_per_unit,
    vat_rate: normalizeVatRate(item.vat_rate),
  }));

  const { data, error } = await supabase
    .from("cogs_items")
    .upsert(rows, { onConflict: "store_name,sku" })
    .select();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ inserted: data?.length || 0 });
}

export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { id, cogs_per_unit, product_name, vat_rate } = body as {
    id: string;
    cogs_per_unit?: number;
    product_name?: string;
    vat_rate?: number;
  };

  if (!id || (cogs_per_unit == null && vat_rate == null && product_name === undefined)) {
    return Response.json(
      { error: "id and at least one of cogs_per_unit, vat_rate, product_name are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cogs_per_unit != null) {
    updateData.cogs_per_unit = cogs_per_unit;
  }
  if (vat_rate != null) {
    updateData.vat_rate = normalizeVatRate(vat_rate);
  }
  if (product_name !== undefined) {
    updateData.product_name = product_name;
  }

  const { error } = await supabase
    .from("cogs_items")
    .update(updateData)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase.from("cogs_items").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
