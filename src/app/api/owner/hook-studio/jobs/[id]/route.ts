import { requireOwner } from "@/lib/hook-studio/auth";

export const dynamic = "force-dynamic";

/** DELETE — cancel a job that has not started. Running jobs finish on their own. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const { data, error } = await auth.db
    .from("hook_studio_jobs")
    .update({ status: "canceled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return Response.json({ error: "Already started; let it finish" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
