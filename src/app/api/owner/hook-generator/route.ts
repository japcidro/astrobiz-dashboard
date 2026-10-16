import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { isBeatKind, validClipSeconds } from "@/lib/hook-generator/engines";
import { createHooks, loadHooks, planAndStart, type RefInput } from "@/lib/hook-generator/views";
import type { BeatKind, RefRole } from "@/lib/hook-generator/types";

export const dynamic = "force-dynamic";
// Claude plans every variant after the response goes out.
export const maxDuration = 300;

/** GET — every Hook Generator hook, newest first. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json({ hooks: await loadHooks(auth.db) });
}

/**
 * POST — make hooks: { direction, line?, kinds?: BeatKind[], refs: [{ path | person_id, role, name? }], image_model?, video_model?, clip_seconds?, hold_stills?, variants?, batch_id? }.
 * No kinds = planned from the direction alone. clip_seconds: a length the video model accepts, else each beat fits its line.
 * Rows are saved in "planning" and returned at once; Claude plans them in the background, then the Mac worker draws the starting images.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const refs: RefInput[] = (Array.isArray(b.refs) ? b.refs : []).map((r: Record<string, unknown>) => ({
    path: str(r?.path) || undefined,
    person_id: isUuid(r?.person_id) ? r.person_id : undefined,
    role: str(r?.role) as RefRole,
    name: str(r?.name),
  }));
  const video = b.video_model === "seedance_2_0_mini" ? "seedance_2_0_mini" : "veo3_1";
  const result = await createHooks(auth.db, {
    direction: str(b.direction),
    line: str(b.line),
    kinds: (Array.isArray(b.kinds) ? b.kinds : []).filter(isBeatKind) as BeatKind[],
    refs,
    image_model: b.image_model === "nano_banana_pro" ? "nano_banana_pro" : "seedream_5_0_flash",
    video_model: video,
    clip_seconds: validClipSeconds(video, b.clip_seconds),
    hold_stills: b.hold_stills === true,
    variants: typeof b.variants === "number" ? b.variants : 1,
    batch_id: isUuid(b.batch_id) ? b.batch_id : null,
    created_by: auth.employee.id,
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  const db = auth.db;
  after(async () => {
    await Promise.all(result.ids.map((id) => planAndStart(db, id)));
  });
  return Response.json({ ids: result.ids, hooks: await loadHooks(db) });
}
