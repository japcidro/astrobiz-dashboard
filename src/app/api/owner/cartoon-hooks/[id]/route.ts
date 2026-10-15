import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { voiceElevenLabsBeats } from "@/lib/cartoon/elevenlabs";
import { deleteHook, loadHook, planAndStart } from "@/lib/cartoon/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** GET — one hook with its beats, images, clips and voiceover lines. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const hook = await loadHook(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });
  // ElevenLabs lines are made by the app: pick up any the planning request did not finish.
  if (hook.voice_on && hook.voice_provider === "elevenlabs" && hook.status === "working" && hook.beats.some((b) => b.voice_status === null || b.voice_status === "running")) {
    const db = auth.db;
    after(() => voiceElevenLabsBeats(db, id));
  }
  return Response.json(hook);
}

/** POST — { action: "replan" }: Claude splits the script again; the beats and their files are replaced. */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as { action?: string } | null;
  if (b?.action !== "replan") return Response.json({ error: "Unknown action" }, { status: 400 });
  const { error } = await auth.db.from("cartoon_hooks").update({ status: "planning", error: null, title: "Planning…" }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const db = auth.db;
  after(async () => {
    await planAndStart(db, id);
  });
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
