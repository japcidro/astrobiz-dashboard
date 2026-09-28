import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { getEngine, type Quality, type RemakeParams } from "@/lib/hook-studio/engines";

export const dynamic = "force-dynamic";

/**
 * POST — queue remakes for the Mac worker.
 * Body: { engine, quality?: "standard" | "high", count?: 1..3 }
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const hook = await loadHookView(auth.db, id);
  if (!hook) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => null)) as { engine?: string; quality?: string; count?: number } | null;
  const engine = getEngine(String(b?.engine ?? ""));
  if (!engine) return Response.json({ error: "Pick an engine" }, { status: 400 });
  const quality: Quality = b?.quality === "high" ? "high" : "standard";
  const count = Math.min(3, Math.max(1, Math.round(Number(b?.count ?? 1)) || 1));

  if (!hook.reference_path) return Response.json({ error: "This hook has no reference video" }, { status: 400 });
  if (!hook.edit_prompt?.trim()) return Response.json({ error: "Write the edit prompt first" }, { status: 400 });
  if (engine.needsFace && !hook.face) {
    return Response.json({ error: `${engine.name} needs a pinned face` }, { status: 400 });
  }

  const params: RemakeParams = {
    engine: engine.id,
    quality,
    prompt: hook.edit_prompt.trim(),
    reference_path: hook.reference_path,
    trim_start: Number(hook.trim_start) || 0,
    trim_end: hook.trim_end === null ? null : Number(hook.trim_end),
    face_path: engine.usesFace && hook.face ? hook.face.image_path : null,
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
