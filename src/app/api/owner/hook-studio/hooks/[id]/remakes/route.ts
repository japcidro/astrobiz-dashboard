import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { getEngine, type Quality, type RemakeParams } from "@/lib/hook-studio/engines";

export const dynamic = "force-dynamic";

/**
 * POST — queue clips for the Mac worker using the hook's engine settings.
 * Body: { count?: 1..3, engine?, quality?, duration? } (overrides are saved on the hook)
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const hook = await loadHookView(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => ({}))) as { count?: number; engine?: string; quality?: string; duration?: number };
  const engine = getEngine(b.engine ?? hook.engine ?? "");
  if (!engine || engine.skill !== hook.skill) return Response.json({ error: "Pick an engine for this skill" }, { status: 400 });
  const quality: Quality = (b.quality ?? hook.quality) === "high" ? "high" : "standard";
  const duration = Math.min(engine.maxSeconds, Math.max(engine.minSeconds, Math.round(Number(b.duration ?? hook.duration)) || 5));
  const count = Math.min(3, Math.max(1, Math.round(Number(b.count ?? 1)) || 1));

  if (!hook.ugc?.result_path) return Response.json({ error: "This hook has no UGC image" }, { status: 400 });
  if (!hook.edit_prompt?.trim()) return Response.json({ error: "Write the prompt first" }, { status: 400 });
  if (hook.skill === "motion" && !hook.reference_path) {
    return Response.json({ error: "Motion transfer needs a reference clip" }, { status: 400 });
  }

  if (b.engine || b.quality || b.duration) {
    await auth.db.from("hook_studio_hooks").update({ engine: engine.id, quality, duration }).eq("id", id);
  }

  const params: RemakeParams = {
    skill: hook.skill,
    engine: engine.id,
    quality,
    duration,
    prompt: hook.edit_prompt.trim(),
    ugc_path: hook.ugc.result_path,
    reference_path: hook.skill === "motion" ? hook.reference_path : null,
    trim_start: Number(hook.trim_start) || 0,
    trim_end: hook.trim_end === null ? null : Number(hook.trim_end),
  };
  const rows = Array.from({ length: count }, () => ({
    hook_id: id,
    kind: "remake",
    engine: engine.id,
    params,
    status: "queued",
  }));
  const { error } = await auth.db.from("hook_studio_jobs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await loadHookView(auth.db, id));
}
