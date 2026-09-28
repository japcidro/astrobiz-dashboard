import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { writeHookPrompts } from "@/lib/hook-studio/prompt-writer";
import { MAX_REFERENCE_SECONDS } from "@/lib/hook-studio/engines";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — Claude writes the edit prompt and text options for this hook. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const hook = await loadHookView(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });

  const end = hook.trim_end ?? Math.min(hook.reference_duration ?? MAX_REFERENCE_SECONDS, hook.trim_start + MAX_REFERENCE_SECONDS);
  const seconds = Math.max(1, Math.round(end - hook.trim_start));

  const out = await writeHookPrompts(auth.db, {
    lane: hook.lane,
    brief: hook.brief,
    creator: hook.creator,
    screenMode: hook.screen_mode,
    referenceName: hook.reference_name,
    clipSeconds: seconds,
    hasFace: !!hook.face_id,
  });
  if (!out.ok) return Response.json({ error: out.error }, { status: 502 });

  const chosen = hook.chosen_text ?? out.result.text_options[0] ?? null;
  const { error } = await auth.db
    .from("hook_studio_hooks")
    .update({
      edit_prompt: out.result.edit_prompt,
      text_options: out.result.text_options,
      chosen_text: chosen,
      title: chosen,
    })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await loadHookView(auth.db, id));
}
