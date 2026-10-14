import { requireBoardUser } from "@/lib/marketing-board/auth";
import { asClipEngine, isUuid, loadProject } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; shotId: string }> };

/** PATCH — kind, mode, person, selected, approved, script, voice, model, quality, length, prompt. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, shotId } = await ctx.params;
  if (!isUuid(id) || !isUuid(shotId)) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (b.kind === "talking_head" || b.kind === "broll") patch.kind = b.kind;
  if (b.mode === "keep" || b.mode === "swap") patch.mode = b.mode;
  if ("person" in b) patch.person = typeof b.person === "string" && /^[A-F]$/.test(b.person) ? b.person : null;
  if (typeof b.selected === "boolean") patch.selected = b.selected;
  if (typeof b.approved === "boolean") patch.approved = b.approved;
  if (typeof b.script === "string") patch.script = b.script.slice(0, 1500);
  if (typeof b.voice_direction === "string") patch.voice_direction = b.voice_direction.trim().slice(0, 120);
  if ("voice_id" in b) {
    if (b.voice_id === null) Object.assign(patch, { voice_id: null, voice_type: null, voice_name: null });
    else if (typeof b.voice_id === "string" && /^[0-9a-f-]{36}$/.test(b.voice_id) && (b.voice_type === "preset" || b.voice_type === "element")) {
      Object.assign(patch, { voice_id: b.voice_id, voice_type: b.voice_type, voice_name: typeof b.voice_name === "string" ? b.voice_name.slice(0, 60) : null });
    } else return Response.json({ error: "Bad voice" }, { status: 400 });
  }
  if ("clip_engine" in b) {
    const e = asClipEngine(b.clip_engine);
    if (!e) return Response.json({ error: "Unknown model" }, { status: 400 });
    patch.clip_engine = e;
  }
  if (b.clip_quality === "standard" || b.clip_quality === "high") patch.clip_quality = b.clip_quality;
  if ("clip_seconds" in b) patch.clip_seconds = [4, 6, 8].includes(Number(b.clip_seconds)) ? Number(b.clip_seconds) : null;
  if (typeof b.clip_prompt === "string") patch.clip_prompt = b.clip_prompt.trim().slice(0, 3000) || null;
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const { error } = await auth.db.from("remake_shots").update(patch).eq("id", shotId).eq("project_id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: await loadProject(auth.db, id) });
}
