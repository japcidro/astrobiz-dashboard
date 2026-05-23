import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = await createClient();

  const { data: row, error: fetchErr } = await supabase
    .from("brand_reference_files")
    .select("id, file_url")
    .eq("id", id)
    .single();

  if (fetchErr || !row) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  if (row.file_url) {
    const removeRes = await supabase.storage
      .from("brand-files")
      .remove([row.file_url]);
    if (removeRes.error) {
      return Response.json(
        { error: `Storage delete failed: ${removeRes.error.message}` },
        { status: 500 }
      );
    }
  }

  const { error: deleteErr } = await supabase
    .from("brand_reference_files")
    .delete()
    .eq("id", id);

  if (deleteErr) {
    return Response.json({ error: deleteErr.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
