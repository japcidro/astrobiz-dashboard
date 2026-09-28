import { requireOwner } from "@/lib/hook-studio/auth";
import { signPaths } from "@/lib/hook-studio/storage";
import { DEFAULT_ENGINE, MAX_REFERENCE_SECONDS, SKILLS, getEngine, type EngineId, type Quality, type Skill } from "@/lib/hook-studio/engines";
import type { HookRow, JobRow, LibraryRow } from "@/lib/hook-studio/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/** GET /api/owner/hook-studio/hooks — the library, newest first. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { db } = auth;

  const [{ data: hooks }, { data: jobs }] = await Promise.all([
    db.from("hook_studio_hooks").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("hook_studio_jobs").select("id,hook_id,kind,status,estimate_credits,result_path,params").in("kind", ["remake", "ugc_image"]),
  ]);
  const hookRows = (hooks ?? []) as HookRow[];
  const jobRows = (jobs ?? []) as Pick<JobRow, "id" | "hook_id" | "kind" | "status" | "estimate_credits" | "result_path" | "params">[];
  const ugcById = new Map(jobRows.filter((j) => j.kind === "ugc_image").map((j) => [j.id, j]));
  const signed = await signPaths(db, hookRows.map((h) => (h.ugc_job_id ? ugcById.get(h.ugc_job_id)?.result_path : null)));

  const byHook = new Map<string, LibraryRow>();
  for (const h of hookRows) {
    const ugc = h.ugc_job_id ? ugcById.get(h.ugc_job_id) : undefined;
    byHook.set(h.id, {
      id: h.id,
      title: h.title || h.brief.slice(0, 80) || "Untitled hook",
      skill: h.skill,
      engine: h.engine,
      duration: h.duration,
      ugc_url: ugc?.result_path ? signed.get(ugc.result_path) ?? null : null,
      clips_done: 0,
      clips_pending: 0,
      clips_failed: 0,
      credits: 0,
      created_at: h.created_at,
    });
  }
  let monthCredits = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  for (const j of jobRows) {
    if (j.kind !== "remake") continue;
    const row = j.hook_id ? byHook.get(j.hook_id) : undefined;
    if (!row) continue;
    if (j.status === "done") {
      row.clips_done++;
      row.credits += Number(j.estimate_credits ?? 0);
      if (new Date(row.created_at) >= monthStart) monthCredits += Number(j.estimate_credits ?? 0);
    } else if (j.status === "queued" || j.status === "running") row.clips_pending++;
    else if (j.status === "failed") row.clips_failed++;
  }

  return Response.json({
    hooks: Array.from(byHook.values()),
    month_credits: Math.round(monthCredits * 100) / 100,
  });
}

/**
 * POST /api/owner/hook-studio/hooks — create a hook on a UGC image.
 * Body: { ugc_job_id, skill, brief?, engine?, quality?, duration?,
 *         reference_path?, reference_name?, reference_duration?, width?, height?,
 *         trim_start?, trim_end? }
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { db, user } = auth;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const ugcJobId = typeof b.ugc_job_id === "string" && UUID.test(b.ugc_job_id) ? b.ugc_job_id : null;
  if (!ugcJobId) return Response.json({ error: "Pick a UGC image first" }, { status: 400 });
  const { data: ugc } = await db.from("hook_studio_jobs").select("id,kind,status,result_path").eq("id", ugcJobId).maybeSingle();
  if (!ugc || ugc.kind !== "ugc_image" || ugc.status !== "done" || !ugc.result_path) {
    return Response.json({ error: "That UGC image is not ready" }, { status: 400 });
  }

  const skill = String(b.skill ?? "motion") as Skill;
  if (!SKILLS.some((s) => s.id === skill)) return Response.json({ error: "Unknown skill" }, { status: 400 });
  const engineId = (typeof b.engine === "string" ? b.engine : DEFAULT_ENGINE[skill]) as EngineId;
  const engine = getEngine(engineId);
  if (!engine || engine.skill !== skill) return Response.json({ error: "Engine does not match the skill" }, { status: 400 });
  const quality: Quality = b.quality === "high" ? "high" : "standard";
  const duration = Math.min(engine.maxSeconds, Math.max(engine.minSeconds, Math.round(Number(b.duration ?? 5)) || 5));

  const referencePath = typeof b.reference_path === "string" ? b.reference_path : null;
  if (referencePath && !/^refs\/[0-9a-f-]{36}\.(mp4|mov)$/.test(referencePath)) {
    return Response.json({ error: "Bad reference path" }, { status: 400 });
  }
  if (skill === "motion" && !referencePath) {
    return Response.json({ error: "Motion transfer needs a reference clip" }, { status: 400 });
  }
  const refDuration = Number(b.reference_duration);
  const trimStart = Math.max(0, Number(b.trim_start ?? 0) || 0);
  let trimEnd = b.trim_end === null || b.trim_end === undefined ? null : Number(b.trim_end);
  if (trimEnd !== null && !(trimEnd > trimStart)) trimEnd = null;
  const spanEnd = trimEnd ?? (Number.isFinite(refDuration) ? refDuration : trimStart + MAX_REFERENCE_SECONDS);
  if (spanEnd - trimStart > MAX_REFERENCE_SECONDS) trimEnd = trimStart + MAX_REFERENCE_SECONDS;

  const brief = String(b.brief ?? "").slice(0, 2000);
  const { data, error } = await db
    .from("hook_studio_hooks")
    .insert({
      brief,
      title: brief.slice(0, 80) || null,
      skill,
      engine: engine.id,
      quality,
      duration,
      ugc_job_id: ugcJobId,
      reference_path: referencePath,
      reference_name: typeof b.reference_name === "string" ? b.reference_name.slice(0, 200) : null,
      reference_duration: Number.isFinite(refDuration) ? refDuration : null,
      reference_width: Number.isFinite(Number(b.width)) ? Number(b.width) : null,
      reference_height: Number.isFinite(Number(b.height)) ? Number(b.height) : null,
      trim_start: trimStart,
      trim_end: trimEnd,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  return Response.json({ id: data.id });
}
