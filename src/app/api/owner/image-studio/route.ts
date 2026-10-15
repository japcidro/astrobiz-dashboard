import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import type { RunInput } from "@/lib/image-studio/types";
import { createRun, loadStudioPage, runPendingChecks } from "@/lib/image-studio/views";

export const dynamic = "force-dynamic";

/** GET ?item=<board card> — the studio: the card, attachable images, and runs with results (checks run first). */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const item = new URL(request.url).searchParams.get("item");
  const itemId = isUuid(item) ? item : null;
  await runPendingChecks(auth.db, itemId).catch(() => {});
  return Response.json(await loadStudioPage(auth.db, itemId));
}

/** POST — a new run: instruction, attachments with roles, toggles. Queues the renders. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Partial<RunInput> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const result = await createRun(
    auth.db,
    {
      item_id: isUuid(b.item_id) ? b.item_id : null,
      store: typeof b.store === "string" && b.store.trim() ? b.store.trim().slice(0, 80) : null,
      preset: pick(b.preset, ["adapt", "before_after", "product_only", "model_only", "testimonial", "blank"] as const, "blank"),
      instruction: typeof b.instruction === "string" ? b.instruction : "",
      product_mode: pick(b.product_mode, ["in", "none"] as const, "in"),
      person_mode: pick(b.person_mode, ["model", "none", "new"] as const, "model"),
      output: pick(b.output, ["single", "pair", "set3"] as const, "single"),
      format: pick(b.format, ["1:1", "4:5", "9:16", "1.91:1"] as const, "1:1"),
      versions: typeof b.versions === "number" ? b.versions : 1,
      text_on_image: typeof b.text_on_image === "string" ? b.text_on_image : "",
      text_style: pick(b.text_style, ["reference", "clean"] as const, "reference"),
      attachments: Array.isArray(b.attachments) ? (b.attachments as RunInput["attachments"]) : [],
    },
    auth.employee.id
  );
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  const page = await loadStudioPage(auth.db, isUuid(b.item_id) ? b.item_id : null);
  return Response.json({ id: result.id, runs: page.runs });
}
