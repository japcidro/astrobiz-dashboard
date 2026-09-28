import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { writeVideoPrompt } from "@/lib/hook-studio/prompt-writer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — Claude looks at the UGC image and writes the video prompt for this hook's skill. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const hook = await loadHookView(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });

  const out = await writeVideoPrompt(auth.db, {
    skill: hook.skill,
    brief: hook.brief,
    seconds: hook.duration,
    imageUrl: hook.ugc?.result_url ?? null,
    referenceName: hook.reference_name,
  });
  if (!out.ok) return Response.json({ error: out.error }, { status: 502 });

  const { error } = await auth.db.from("hook_studio_hooks").update({ edit_prompt: out.prompt }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await loadHookView(auth.db, id));
}
