import { requireOwner } from "@/lib/hook-studio/auth";
import { loadUgcLibrary } from "@/lib/hook-studio/views";
import { UGC_ENGINE, UGC_MAX_PER_BATCH, type UgcParams } from "@/lib/hook-studio/engines";
import { ugcSwapPrompt } from "@/lib/hook-studio/presets";

export const dynamic = "force-dynamic";

/** GET — the UGC Generator library, newest first. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  return Response.json({ items: await loadUgcLibrary(auth.db) });
}

/**
 * POST — queue person swaps on an uploaded photo.
 * Body: { source_path, note?, count?: 1..4 }
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;

  const b = (await request.json().catch(() => null)) as { source_path?: string; note?: string; count?: number } | null;
  const source = typeof b?.source_path === "string" ? b.source_path : "";
  if (!/^ugc-sources\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(source)) {
    return Response.json({ error: "Upload the photo first" }, { status: 400 });
  }
  const note = String(b?.note ?? "").slice(0, 300);
  const count = Math.min(UGC_MAX_PER_BATCH, Math.max(1, Math.round(Number(b?.count ?? 1)) || 1));

  const params: UgcParams = { source_path: source, prompt: ugcSwapPrompt(note), note };
  const rows = Array.from({ length: count }, () => ({
    kind: "ugc_image",
    engine: UGC_ENGINE,
    params,
    status: "queued",
  }));
  const { error } = await auth.db.from("hook_studio_jobs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: await loadUgcLibrary(auth.db) });
}
