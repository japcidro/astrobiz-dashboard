import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { createAdaptRun } from "@/lib/image-studio/adapt";
import { loadStudioPage } from "@/lib/image-studio/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST — the adapt skill: { item_id?, store, reference: {bucket, path, label}, notes?, versions?, model?, change?: {run_id, note} }.
 * Studies the reference, plans our version, queues the renders; the reviewer runs when they land.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const pic = (v: unknown) => {
    const x = v as { bucket?: unknown; path?: unknown; label?: unknown } | null;
    return x && typeof x.bucket === "string" && typeof x.path === "string" ? { bucket: x.bucket, path: x.path, label: typeof x.label === "string" ? x.label : "" } : null;
  };
  const reference = pic(b.reference);
  if (!reference) return Response.json({ error: "Pick a reference" }, { status: 400 });
  const change = b.change && typeof b.change === "object" && isUuid((b.change as { run_id?: unknown }).run_id) ? { run_id: (b.change as { run_id: string }).run_id, note: String((b.change as { note?: unknown }).note ?? "").slice(0, 500) } : null;
  const result = await createAdaptRun(
    auth.db,
    {
      item_id: isUuid(b.item_id) ? b.item_id : null,
      store: typeof b.store === "string" ? b.store.trim().slice(0, 80) : "",
      reference,
      notes: typeof b.notes === "string" ? b.notes : "",
      versions: typeof b.versions === "number" ? b.versions : 4,
      model: pic(b.model),
      change,
    },
    auth.employee.id
  );
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  const page = await loadStudioPage(auth.db, isUuid(b.item_id) ? b.item_id : null);
  return Response.json({ id: result.id, runs: page.runs });
}
