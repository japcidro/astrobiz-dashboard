import { requireOwner } from "@/lib/hook-studio/auth";
import { loadHookView } from "@/lib/hook-studio/views";
import { HOOK_BUCKET } from "@/lib/hook-studio/storage";
import { MAX_REFERENCE_SECONDS, SKILLS, getEngine, type Skill } from "@/lib/hook-studio/engines";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f-]{36}$/;

/** GET — the hook, its UGC image, reference and clips, with signed URLs. Polled by the page. */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const view = await loadHookView(auth.db, id);
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(view);
}

/** PATCH — edit the brief, prompt, skill, engine, quality, duration, reference, trim or UGC image. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.brief === "string") {
    patch.brief = b.brief.slice(0, 2000);
    patch.title = b.brief.slice(0, 80) || null;
  }
  if (typeof b.edit_prompt === "string") patch.edit_prompt = b.edit_prompt.slice(0, 4000);
  if (typeof b.skill === "string") {
    if (!SKILLS.some((s) => s.id === b.skill)) return Response.json({ error: "Unknown skill" }, { status: 400 });
    patch.skill = b.skill;
  }
  if (typeof b.engine === "string") {
    const e = getEngine(b.engine);
    if (!e) return Response.json({ error: "Unknown engine" }, { status: 400 });
    const skill = (patch.skill as Skill | undefined) ?? undefined;
    if (skill && e.skill !== skill) return Response.json({ error: "Engine does not match the skill" }, { status: 400 });
    patch.engine = e.id;
    if (!skill) patch.skill = e.skill;
  }
  if (b.quality === "standard" || b.quality === "high") patch.quality = b.quality;
  if (b.duration !== undefined) {
    const d = Math.round(Number(b.duration));
    if (!Number.isFinite(d) || d < 3 || d > 15) return Response.json({ error: "Duration must be 3 to 15 seconds" }, { status: 400 });
    patch.duration = d;
  }
  if (b.ugc_job_id === null || (typeof b.ugc_job_id === "string" && UUID.test(b.ugc_job_id))) patch.ugc_job_id = b.ugc_job_id;
  if (b.reference_path === null) {
    patch.reference_path = null;
    patch.reference_name = null;
    patch.reference_duration = null;
  } else if (typeof b.reference_path === "string") {
    if (!/^refs\/[0-9a-f-]{36}\.(mp4|mov)$/.test(b.reference_path)) return Response.json({ error: "Bad reference path" }, { status: 400 });
    patch.reference_path = b.reference_path;
    if (typeof b.reference_name === "string") patch.reference_name = b.reference_name.slice(0, 200);
    if (Number.isFinite(Number(b.reference_duration))) patch.reference_duration = Number(b.reference_duration);
    patch.trim_start = 0;
    patch.trim_end = Number.isFinite(Number(b.reference_duration)) ? Math.min(Number(b.reference_duration), MAX_REFERENCE_SECONDS) : null;
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
  return Response.json(await loadHookView(auth.db, id));
}

/** DELETE — remove the hook, its clips (cascade) and its files. The UGC image stays in its library. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const view = await loadHookView(auth.db, id);
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });

  const paths = [view.reference_path, ...view.jobs.map((j) => j.result_path)].filter((p): p is string => !!p);
  if (paths.length > 0) await auth.db.storage.from(HOOK_BUCKET).remove(paths);
  const { error } = await auth.db.from("hook_studio_hooks").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
