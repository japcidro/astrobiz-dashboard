import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { ProjectRow, ShotRow } from "@/lib/remake/types";
import { isUuid, loadProject, queueClip, queueStill, queueVoice } from "@/lib/remake/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; shotId: string; action: string }> };

/**
 * POST — queue work on one shot for the Mac worker:
 *   still  → new person + our product on the real frame
 *   voice  → text-to-speech of the script
 *   clip   → animate the approved still with the chosen model
 */
export async function POST(_request: Request, ctx: Ctx) {
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

  let problem: string | null;
  if (action === "still") {
    if (shot.still_status === "queued" || shot.still_status === "running") return Response.json({ error: "Still is already being made" }, { status: 409 });
    problem = await queueStill(db, project as ProjectRow, shot as ShotRow);
  } else if (action === "voice") {
    if (shot.audio_status === "queued" || shot.audio_status === "running") return Response.json({ error: "Voice is already being made" }, { status: 409 });
    problem = await queueVoice(db, project as ProjectRow, shot as ShotRow);
  } else if (action === "clip") {
    if (shot.clip_status === "queued" || shot.clip_status === "running") return Response.json({ error: "Clip is already rendering" }, { status: 409 });
    problem = await queueClip(db, project as ProjectRow, shot as ShotRow);
  } else {
    return Response.json({ error: "Unknown action" }, { status: 404 });
  }
  if (problem) return Response.json({ error: problem }, { status: 400 });
  return Response.json({ project: await loadProject(db, id) });
}
