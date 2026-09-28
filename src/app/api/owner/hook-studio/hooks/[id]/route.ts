import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { CREATORS, SCREEN_MODES } from "@/lib/hook-studio/presets";
import { MAX_REFERENCE_SECONDS } from "@/lib/hook-studio/engines";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f-]{36}$/;

/** GET — the hook, its jobs and pinned face, with signed URLs. Polled by the page. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const view = await loadHookView(auth.db, id);
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(view);
}

/**
 * PATCH — edit the brief, prompt, chosen text, creator, screen mode, trim, face.
 * Only the fields present in the body change.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.brief === "string") patch.brief = b.brief.slice(0, 2000);
  if (typeof b.edit_prompt === "string") patch.edit_prompt = b.edit_prompt.slice(0, 4000);
  if (b.chosen_text === null || typeof b.chosen_text === "string") {
    patch.chosen_text = b.chosen_text === null ? null : String(b.chosen_text).slice(0, 200);
    patch.title = patch.chosen_text;
  }
  if (Array.isArray(b.text_options)) {
    patch.text_options = b.text_options.filter((t) => typeof t === "string").map((t) => String(t).slice(0, 200)).slice(0, 6);
  }
  if (typeof b.creator === "string") {
    if (!(CREATORS as readonly string[]).includes(b.creator)) {
      return Response.json({ error: "Unknown creator preset" }, { status: 400 });
    }
    patch.creator = b.creator;
  }
  if (typeof b.screen_mode === "string") {
    if (!SCREEN_MODES.some((s) => s.id === b.screen_mode)) {
      return Response.json({ error: "Unknown screen mode" }, { status: 400 });
    }
    patch.screen_mode = b.screen_mode;
  }
  if (b.face_id === null || (typeof b.face_id === "string" && UUID.test(b.face_id))) {
    patch.face_id = b.face_id;
  }
  if (b.trim_start !== undefined || b.trim_end !== undefined) {
    const start = Math.max(0, Number(b.trim_start ?? 0) || 0);
    let end = b.trim_end === null || b.trim_end === undefined ? null : Number(b.trim_end);
    if (end !== null && !(end > start)) return Response.json({ error: "Trim end must be after the start" }, { status: 400 });
    if (end !== null && end - start > MAX_REFERENCE_SECONDS) end = start + MAX_REFERENCE_SECONDS;
    patch.trim_start = start;
    patch.trim_end = end;
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const { error } = await auth.db.from("hook_studio_hooks").update(patch).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const view = await loadHookView(auth.db, id);
  return Response.json(view);
}

/** DELETE — remove the hook, its jobs (cascade) and its files. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const view = await loadHookView(auth.db, id);
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });

  const paths = [view.reference_path, ...view.jobs.map((j) => j.result_path)].filter(
    (p): p is string => !!p
  );
  if (paths.length > 0) await auth.db.storage.from("hook-studio").remove(paths);
  const { error } = await auth.db.from("hook_studio_hooks").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
