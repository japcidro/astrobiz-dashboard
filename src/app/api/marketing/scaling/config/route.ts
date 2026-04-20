import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_scaling_campaigns")
    .select("*")
    .order("store_name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ rows: data ?? [] });
}

export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    store_name?: string;
    account_id?: string;
    campaign_id?: string;
    campaign_name?: string;
  };

  const store_name = (body.store_name ?? "").trim();
  const account_id = (body.account_id ?? "").trim();
  const campaign_id = (body.campaign_id ?? "").trim();
  const campaign_name = (body.campaign_name ?? "").trim();

  if (!store_name || !account_id || !campaign_id || !campaign_name) {
    return Response.json(
      {
        error:
          "store_name, account_id, campaign_id, and campaign_name are required",
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_scaling_campaigns")
    .upsert(
      {
        store_name,
        account_id,
        campaign_id,
        campaign_name,
        updated_by: employee.id,
      },
      { onConflict: "store_name" }
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ row: data });
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
  const store = searchParams.get("store");
  if (!store) {
    return Response.json({ error: "store required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_scaling_campaigns")
    .delete()
    .eq("store_name", store);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
