import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  APPROVED_SCRIPT_STATUSES,
  type UpdateApprovedScriptInput,
} from "@/lib/ai/approved-scripts-types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approved_scripts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ script: data });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as UpdateApprovedScriptInput;

  if (body.status && !APPROVED_SCRIPT_STATUSES.includes(body.status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_by: employee.id };
  if (body.status !== undefined) updates.status = body.status;
  if (body.production_notes !== undefined) updates.production_notes = body.production_notes;
  if (body.final_video_url !== undefined) updates.final_video_url = body.final_video_url;
  if (body.angle_title !== undefined) updates.angle_title = body.angle_title;
  if (body.hook !== undefined) updates.hook = body.hook;
  if (body.body_script !== undefined) updates.body_script = body.body_script;
  if (body.variant_hooks !== undefined) updates.variant_hooks = body.variant_hooks;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approved_scripts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ script: data });
}

// DELETE — admin only (per RLS policy). Use status='archived' for soft delete.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase.from("approved_scripts").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
