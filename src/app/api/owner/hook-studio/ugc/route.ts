import { requireOwner } from "@/lib/hook-studio/auth";
import { loadUgcLibrary } from "@/lib/hook-studio/views";
import { UGC_ENGINE, UGC_MAX_PER_BATCH, type UgcParams } from "@/lib/hook-studio/engines";
import { DEFAULT_LOOK, isLookId, resolveLook, ugcSwapPrompt } from "@/lib/hook-studio/presets";

export const dynamic = "force-dynamic";

/** GET — the UGC Generator library, newest first. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  return Response.json({ items: await loadUgcLibrary(auth.db) });
}

/**
 * POST — queue person swaps on an uploaded photo.
 * Body: { source_path, note?, look?, count?: 1..4 }
 * With look "varied" (the default) each image in the batch gets a different
 * look from the US mix, so four images come back as four different people.
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;

  const b = (await request.json().catch(() => null)) as { source_path?: string; note?: string; look?: string; count?: number } | null;
  const source = typeof b?.source_path === "string" ? b.source_path : "";
  if (!/^ugc-sources\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(source)) {
    return Response.json({ error: "Upload the photo first" }, { status: 400 });
  }
  const note = String(b?.note ?? "").slice(0, 300);
  const look = isLookId(b?.look) ? b!.look! : DEFAULT_LOOK;
  const count = Math.min(UGC_MAX_PER_BATCH, Math.max(1, Math.round(Number(b?.count ?? 1)) || 1));

  const rows = Array.from({ length: count }, (_, i) => {
    const concrete = resolveLook(look, i);
    const params: UgcParams & { look: string; look_choice: string } = {
      source_path: source,
      prompt: ugcSwapPrompt(note, concrete),
      note,
      look: concrete,
      look_choice: look,
    };
    return { kind: "ugc_image", engine: UGC_ENGINE, params, status: "queued" };
  });
  const { error } = await auth.db.from("hook_studio_jobs").insert(rows);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: await loadUgcLibrary(auth.db) });
}
