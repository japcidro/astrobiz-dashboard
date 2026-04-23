import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { UpdateApprovedScriptCreativeInput } from "@/lib/ai/approved-script-creatives-types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; creativeId: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { creativeId } = await params;
  const body = (await request.json()) as UpdateApprovedScriptCreativeInput;

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label?.trim() || null;
  if (body.thumbnail_url !== undefined)
    updates.thumbnail_url = body.thumbnail_url ?? null;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approved_script_creatives")
    .update(updates)
    .eq("id", creativeId)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ creative: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; creativeId: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { creativeId } = await params;
  const supabase = await createClient();

  const { error } = await supabase
    .from("approved_script_creatives")
    .delete()
    .eq("id", creativeId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
