import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { ProjectRow, ShotRow } from "@/lib/remake/types";
import { isUuid, loadProject, mergeShot, queueClip, queueStill, queueVoice, splitShot } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; shotId: string; action: string }> };

/**
 * POST — act on one clip:
 *   still       → the cast person + our product on the real frame (Mac worker)
 *   voice       → ElevenLabs voiceover of the script
 *   clip        → animate the approved still with the chosen model
 *   split       → { at: seconds } cut this clip in two
 *   merge       → join with the next clip
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id, shotId, action } = await ctx.params;
  if (!isUuid(id) || !isUuid(shotId)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = auth;

  const [{ data: project }, { data: shot }] = await Promise.all([
    db.from("remake_projects").select("*").eq("id", id).maybeSingle(),
    db.from("remake_shots").select("*").eq("id", shotId).eq("project_id", id).maybeSingle(),
  ]);
  if (!project || !shot) return Response.json({ error: "Not found" }, { status: 404 });
  const p = project as ProjectRow;
  const s = shot as ShotRow;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  let problem: string | null;
  switch (action) {
    case "still":
      if (s.still_status === "queued" || s.still_status === "running") return Response.json({ error: "Still is already being made" }, { status: 409 });
      problem = await queueStill(db, p, s);
      break;
    case "voice":
      if (s.audio_status === "queued" || s.audio_status === "running") return Response.json({ error: "Voice is already being made" }, { status: 409 });
      problem = await queueVoice(db, p, s);
      break;
    case "clip":
      if (s.clip_status === "queued" || s.clip_status === "running") return Response.json({ error: "Clip is already rendering" }, { status: 409 });
      problem = await queueClip(db, p, s);
      break;
    case "split":
      problem = await splitShot(db, p, s, Number(body.at));
      break;
    case "merge":
      problem = await mergeShot(db, p, s);
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 404 });
  }
  if (problem) return Response.json({ error: problem }, { status: 400 });
  return Response.json({ project: await loadProject(db, id) });
}
