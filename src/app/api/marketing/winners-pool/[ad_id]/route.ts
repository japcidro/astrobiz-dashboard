import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// DELETE /api/marketing/winners-pool/[ad_id]   remove from Log Pool
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

// PATCH /api/marketing/winners-pool/[ad_id]   body: { is_winner: boolean }
// Sets the manual Winner/Loser classification for an ad already in the pool.
// Untagged (is_winner=false) means LOSER / didn't work / didn't fit metrics —
// the Log generator uses this as ground truth, not metrics.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ ad_id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ad_id } = await ctx.params;
  if (!ad_id) return Response.json({ error: "ad_id required" }, { status: 400 });

  const body = (await req.json()) as { is_winner?: boolean };
  if (typeof body.is_winner !== "boolean") {
    return Response.json(
      { error: "is_winner (boolean) required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("winner_pool_ads")
    .update({ is_winner: body.is_winner })
    .eq("ad_id", ad_id)
    .select("ad_id, is_winner")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) {
    return Response.json(
      { error: "Ad is not in the Log Pool" },
      { status: 404 }
    );
  }
  return Response.json({ ad: data });
}
