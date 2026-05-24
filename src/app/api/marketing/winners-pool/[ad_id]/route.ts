import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// DELETE /api/marketing/winners-pool/[ad_id]   untag a winner
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ ad_id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ad_id } = await ctx.params;
  if (!ad_id) return Response.json({ error: "ad_id required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("winner_pool_ads")
    .delete()
    .eq("ad_id", ad_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
