import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface PostBody {
  shopify_order_id: string;
  shopify_order_name?: string;
  error_type: string;
  packed_by?: string;          // employee id of packer (optional)
  notes?: string;
  occurred_on?: string;        // YYYY-MM-DD; defaults to today
}

const VALID_ERROR_TYPES = [
  "wrong_item",
  "missing_item",
  "wrong_quantity",
  "damaged",
  "missing_freebie",
  "late_ship",
  "other",
];

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as PostBody;
  if (!body.shopify_order_id || !VALID_ERROR_TYPES.includes(body.error_type)) {
    return Response.json(
      { error: "shopify_order_id and valid error_type required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("packing_errors").insert({
    shopify_order_id: body.shopify_order_id,
    shopify_order_name: body.shopify_order_name ?? null,
    error_type: body.error_type,
    packed_by: body.packed_by ?? null,
    logged_by: employee.id,
    notes: body.notes ?? null,
    occurred_on: body.occurred_on ?? new Date().toISOString().slice(0, 10),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "fulfillment" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("packing_errors")
    .select("id, shopify_order_id, shopify_order_name, error_type, packed_by, notes, occurred_on, created_at")
    .gte("occurred_on", since.slice(0, 10))
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data ?? [] });
}
