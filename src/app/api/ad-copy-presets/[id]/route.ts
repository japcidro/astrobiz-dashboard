import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { UpdateAdCopyPresetInput } from "@/lib/ad-copy-presets/types";

export const dynamic = "force-dynamic";

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
  const body = (await request.json()) as UpdateAdCopyPresetInput;

  const updates: Record<string, unknown> = {};
  if (typeof body.label === "string") {
    const trimmed = body.label.trim();
    if (!trimmed) {
      return Response.json({ error: "Label cannot be empty" }, { status: 400 });
    }
    updates.label = trimmed;
  }
  if (typeof body.content === "string") {
    if (!body.content.trim()) {
      return Response.json(
        { error: "Content cannot be empty" },
        { status: 400 }
      );
    }
    updates.content = body.content;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_copy_presets")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "Another preset already uses that label." },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ preset: data });
}

export async function DELETE(
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
  const { error } = await supabase
    .from("ad_copy_presets")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
