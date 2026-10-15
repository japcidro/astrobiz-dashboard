import { requireBoardUser } from "@/lib/marketing-board/auth";
import { createTalkingHead, loadRenders, loadTalkingHeadPage } from "@/lib/talking-head/views";

export const dynamic = "force-dynamic";

/** GET — every Clipper still as a starting image, and every talking-head render. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json(await loadTalkingHeadPage(auth.db));
}

/** POST — queue a talking head from a library image: { still_id, script, voice_direction?, voice_gender?, voice_profile?, engine?, quality?, seconds? }. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const result = await createTalkingHead(auth.db, {
    still_id: typeof b.still_id === "string" ? b.still_id : "",
    script: typeof b.script === "string" ? b.script : "",
    voice_direction: typeof b.voice_direction === "string" ? b.voice_direction : "",
    voice_gender: b.voice_gender === "male" || b.voice_gender === "female" ? b.voice_gender : null,
    voice_profile: typeof b.voice_profile === "string" ? b.voice_profile : "",
    engine: b.engine === "veo3" ? "veo3" : "veo3_1",
    quality: b.quality === "high" ? "high" : "standard",
    seconds: b.seconds === 4 || b.seconds === 6 ? b.seconds : 8,
    created_by: auth.employee.id,
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.id, renders: await loadRenders(auth.db) });
}
