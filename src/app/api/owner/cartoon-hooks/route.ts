import { after } from "next/server";
import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { createHooks, loadHooks, planAndStart } from "@/lib/cartoon/views";
import type { CartoonResolution, CartoonStyle } from "@/lib/cartoon/types";

export const dynamic = "force-dynamic";
// Claude plans every variant after the response goes out.
export const maxDuration = 300;

const STYLES: CartoonStyle[] = ["pixar3d", "flat2d", "medical", "mixed"];

/** GET — every cartoon hook, newest first. */
export async function GET() {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  return Response.json({ hooks: await loadHooks(auth.db) });
}

/**
 * POST — make hooks from a script: { script, style?, direction?, resolution?, voice_on?, voice_provider?, voice_id?, voice_type?, voice_name?, variants?, batch_id? }.
 * Rows are saved in "planning" and returned at once; Claude plans them in the background and the Mac worker takes over.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const result = await createHooks(auth.db, {
    script: str(b.script),
    style: STYLES.includes(b.style as CartoonStyle) ? (b.style as CartoonStyle) : "pixar3d",
    direction: str(b.direction),
    resolution: (b.resolution === "720p" ? "720p" : "480p") as CartoonResolution,
    voice_on: b.voice_on === true,
    voice_provider: b.voice_provider === "elevenlabs" ? "elevenlabs" : "higgsfield",
    voice_id: str(b.voice_id) || null,
    voice_type: str(b.voice_type) || null,
    voice_name: str(b.voice_name) || null,
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
