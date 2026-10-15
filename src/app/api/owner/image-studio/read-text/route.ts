import { requireBoardUser } from "@/lib/marketing-board/auth";
import { HOOK_BUCKET, signPaths as signHookPaths } from "@/lib/hook-studio/storage";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { readImageText } from "@/lib/remake/vision";

export const dynamic = "force-dynamic";

/** POST { bucket, path } — the text printed on a reference image, for approval before generating. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as { bucket?: unknown; path?: unknown } | null;
  const bucket = b?.bucket === HOOK_BUCKET ? HOOK_BUCKET : BOARD_BUCKET;
  const path = typeof b?.path === "string" && /^[\w./-]{3,300}$/.test(b.path) && !b.path.includes("..") ? b.path : null;
  if (!path) return Response.json({ error: "Missing image" }, { status: 400 });
  const signed = bucket === HOOK_BUCKET ? await signHookPaths(auth.db, [path]) : await signBoardPaths(auth.db, [path]);
  const url = signed.get(path);
  if (!url) return Response.json({ error: "Image not found" }, { status: 404 });
  const out = await readImageText(auth.db, url);
  if (!out) return Response.json({ error: "Could not read the image (is the Anthropic key set?)" }, { status: 502 });
  return Response.json(out);
}
