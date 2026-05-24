import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET /api/marketing/winners-pool?store=...   (store optional)
// Lists ads currently in the winner pool for a given brand (or all).
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const store = new URL(request.url).searchParams.get("store");
  const supabase = await createClient();

  let q = supabase
    .from("winner_pool_ads")
    .select("ad_id, store_name, tagged_at, tagged_by")
    .order("tagged_at", { ascending: false });
  if (store) q = q.eq("store_name", store);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ads: data ?? [] });
}

// POST /api/marketing/winners-pool   body: { ad_id, store_name? }
// Tags an ad as a winner (idempotent upsert).
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { ad_id, store_name } = body as {
    ad_id?: string;
    store_name?: string | null;
  };
  if (!ad_id) {
    return Response.json({ error: "ad_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("winner_pool_ads")
    .upsert(
      {
        ad_id,
        store_name: store_name ?? null,
        tagged_by: employee.id,
        tagged_at: new Date().toISOString(),
      },
      { onConflict: "ad_id" }
    )
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ad: data });
}
