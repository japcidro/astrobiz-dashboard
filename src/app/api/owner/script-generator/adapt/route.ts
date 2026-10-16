import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { createAdaptRun } from "@/lib/script-studio/adapt";
import { loadStudioPage } from "@/lib/script-studio/views";

export const dynamic = "force-dynamic";
// Study + map, then every version in parallel: two Opus calls deep, about two minutes on a long reference.
export const maxDuration = 300;

/** POST — the adapt skill: { item_id?, store, script, label?, source?, notes?, versions? }. Studies, maps and writes; the reviewer runs from the page's polling. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const source = b.source === "board" || b.source === "winner" ? b.source : "paste";
  const result = await createAdaptRun(
    auth.db,
    {
      item_id: isUuid(b.item_id) ? b.item_id : null,
      store: typeof b.store === "string" ? b.store.trim().slice(0, 80) : "",
      script: typeof b.script === "string" ? b.script : "",
      label: typeof b.label === "string" ? b.label : "",
      source,
      notes: typeof b.notes === "string" ? b.notes : "",
      versions: typeof b.versions === "number" ? b.versions : 2,
    },
    auth.employee.id
  );
  const page = await loadStudioPage(auth.db, isUuid(b.item_id) ? b.item_id : null);
  if ("error" in result) return Response.json({ error: result.error, runs: page.runs }, { status: 400 });
  return Response.json({ id: result.id, runs: page.runs });
}
