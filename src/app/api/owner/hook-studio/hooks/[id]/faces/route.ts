import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { FACES_PER_BATCH, type FaceParams } from "@/lib/hook-studio/engines";
import { facePrompt } from "@/lib/hook-studio/presets";

export const dynamic = "force-dynamic";

/** POST — queue four Soul 2 face candidates for this hook's creator preset. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const hook = await loadHookView(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });

  const params: FaceParams = { prompt: facePrompt(hook.creator), creator: hook.creator };
  const rows = Array.from({ length: FACES_PER_BATCH }, () => ({
    hook_id: id,
    kind: "face",
    engine: "soul",
    params,
    status: "queued",
  }));
  const { error } = await auth.db.from("hook_studio_jobs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await loadHookView(auth.db, id));
}
