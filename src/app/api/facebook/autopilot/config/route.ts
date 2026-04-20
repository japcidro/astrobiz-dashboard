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
    .from("autopilot_config")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ config: data });
}

export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await request.json()) as Partial<{
    enabled: boolean;
    kill_no_purchase_spend_min: number;
    kill_high_cpa_max: number;
  }>;

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("autopilot_config")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!existing?.id) {
    return Response.json(
      { error: "Autopilot config row missing — run autopilot-migration.sql" },
      { status: 500 }
    );
  }

  const update: Record<string, unknown> = {
    updated_by: employee.id,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.kill_no_purchase_spend_min === "number")
    update.kill_no_purchase_spend_min = body.kill_no_purchase_spend_min;
  if (typeof body.kill_high_cpa_max === "number")
    update.kill_high_cpa_max = body.kill_high_cpa_max;

  const { data, error } = await supabase
    .from("autopilot_config")
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ config: data });
}
