import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { anotherTake, approveAll, deleteHook, loadHook, planAndStart, rejoin } from "@/lib/hook-generator/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** GET — one hook with its references, beats, starting images and clips. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const hook = await loadHook(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(hook);
}

/**
 * POST — { action }:
 *   "approve_all": approve every finished starting image; the worker animates the hook
 *   "replan": Claude plans again; the beats and their files are replaced
 *   "rejoin": join the current clips again
 *   "another_take": a new hook from the same inputs, planned in the background; answers { id }
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { action?: string } | null;
  const db = auth.db;
  let problem: string | null;
  if (b?.action === "another_take") {
    const take = await anotherTake(db, id, auth.employee.id);
    if ("error" in take) return Response.json({ error: take.error }, { status: take.error === "Not found" ? 404 : 500 });
    after(async () => {
      await planAndStart(db, take.id);
    });
    return Response.json({ id: take.id });
  }
  if (b?.action === "approve_all") problem = await approveAll(db, id);
  else if (b?.action === "rejoin") problem = await rejoin(db, id);
  else if (b?.action === "replan") {
    const { error } = await db.from("hookgen_hooks").update({ status: "planning", error: null, title: "Planning…" }).eq("id", id);
    problem = error ? error.message : null;
    if (!problem) {
      after(async () => {
        await planAndStart(db, id);
      });
    }
  } else return Response.json({ error: "Unknown action" }, { status: 400 });
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 400 });
  return Response.json(await loadHook(db, id));
}

/** DELETE — remove the hook, its beats and its files. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const problem = await deleteHook(auth.db, id);
  if (problem) return Response.json({ error: problem }, { status: problem === "Not found" ? 404 : 500 });
  return Response.json({ ok: true });
}
