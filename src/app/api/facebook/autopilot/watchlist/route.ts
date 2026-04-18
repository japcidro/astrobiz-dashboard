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
    .from("autopilot_watched_campaigns")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ campaigns: data ?? [] });
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await request.json()) as {
    account_id?: string;
    campaign_id?: string;
    campaign_name?: string;
  };

  if (!body.account_id || !body.campaign_id) {
    return Response.json(
      { error: "account_id and campaign_id are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("autopilot_watched_campaigns")
    .upsert(
      {
        account_id: body.account_id,
        campaign_id: body.campaign_id,
        campaign_name: body.campaign_name ?? null,
        added_by: employee.id,
        added_at: new Date().toISOString(),
      },
      { onConflict: "account_id,campaign_id" }
    )
    .select("*")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ campaign: data });
}

export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const campaign_id = searchParams.get("campaign_id");
  if (!campaign_id) {
    return Response.json(
      { error: "campaign_id query param required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("autopilot_watched_campaigns")
    .delete()
    .eq("campaign_id", campaign_id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
