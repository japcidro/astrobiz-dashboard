import { requireBoardUser } from "@/lib/marketing-board/auth";
import { isUuid } from "@/lib/remake/views";
import { approveOwnPlan, createOwnPlan, deleteOwnPlan, loadOwnPlans, rerunOwn, reviseOwnConcept } from "@/lib/image-studio/own";
import { loadStudioPage } from "@/lib/image-studio/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST — "create your own" (no reference ad), by action:
 *  - plan    { store, product?, brief?, count? }             writes a creative plan for the page; no image credits
 *  - revise  { plan_id, concept_id, note }                   rewrites one concept of a draft
 *  - approve { plan_id, concept_ids, versions?, item_id? }   queues renders for the approved concepts
 *  - change  { run_id, note, versions? }                     reruns an original with a note, keeping its concept
 * Every answer carries the plans; approve and change also carry the runs.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const versions = typeof b.versions === "number" ? b.versions : 1;
  const itemId = isUuid(b.item_id) ? b.item_id : null;

  if (b.action === "plan") {
    const result = await createOwnPlan(auth.db, { store: text(b.store, 80).trim(), product: text(b.product, 60).trim() || null, brief: text(b.brief, 3000), count: typeof b.count === "number" ? b.count : 4 }, auth.employee.id);
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ id: result.plan.id, plans: await loadOwnPlans(auth.db) });
  }
  if (b.action === "revise") {
    const result = await reviseOwnConcept(auth.db, { planId: text(b.plan_id, 40), conceptId: text(b.concept_id, 40), note: text(b.note, 800) });
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ plans: await loadOwnPlans(auth.db) });
  }
  if (b.action === "approve") {
    const ids = Array.isArray(b.concept_ids) ? b.concept_ids.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    const result = await approveOwnPlan(auth.db, { planId: text(b.plan_id, 40), conceptIds: ids, versions, itemId }, auth.employee.id);
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    const page = await loadStudioPage(auth.db, itemId);
    return Response.json({ started: result.started, plans: page.plans, runs: page.runs });
  }
  if (b.action === "change") {
    const result = await rerunOwn(auth.db, { runId: text(b.run_id, 40), note: text(b.note, 500), versions }, auth.employee.id);
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    const page = await loadStudioPage(auth.db, itemId);
    return Response.json({ id: result.id, plans: page.plans, runs: page.runs });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}

/** DELETE ?id=<plan> — drop a plan; its generated runs stay. */
export async function DELETE(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const err = await deleteOwnPlan(auth.db, new URL(request.url).searchParams.get("id") ?? "");
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ plans: await loadOwnPlans(auth.db) });
}
