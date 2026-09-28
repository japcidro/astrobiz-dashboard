import { requireOwner } from "@/lib/hook-studio/auth";
import { signPaths } from "@/lib/hook-studio/storage";
import { LANES, CREATORS, SCREEN_MODES } from "@/lib/hook-studio/presets";
import { MAX_REFERENCE_SECONDS } from "@/lib/hook-studio/engines";
import type { HookRow, JobRow, LibraryRow } from "@/lib/hook-studio/types";

export const dynamic = "force-dynamic";

/** GET /api/owner/hook-studio/hooks — the library, newest first. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { db } = auth;

  const [{ data: hooks }, { data: jobs }] = await Promise.all([
    db.from("hook_studio_hooks").select("*").order("created_at", { ascending: false }).limit(200),
    db
      .from("hook_studio_jobs")
      .select("id,hook_id,kind,status,estimate_credits")
      .eq("kind", "remake"),
  ]);
  const hookRows = (hooks ?? []) as HookRow[];
  const jobRows = (jobs ?? []) as Pick<JobRow, "id" | "hook_id" | "kind" | "status" | "estimate_credits">[];
  const signed = await signPaths(db, hookRows.map((h) => h.reference_path));

  const byHook = new Map<string, LibraryRow>();
  for (const h of hookRows) {
    byHook.set(h.id, {
      id: h.id,
      lane: h.lane,
      title: h.title || h.chosen_text || h.brief.slice(0, 80) || "Untitled hook",
      creator: h.creator,
      reference_url: h.reference_path ? signed.get(h.reference_path) ?? null : null,
      remakes_done: 0,
      remakes_pending: 0,
      remakes_failed: 0,
      credits: 0,
      created_at: h.created_at,
    });
  }
  let monthCredits = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  for (const j of jobRows) {
    const row = j.hook_id ? byHook.get(j.hook_id) : undefined;
    if (!row) continue;
    if (j.status === "done") {
      row.remakes_done++;
      row.credits += Number(j.estimate_credits ?? 0);
      if (new Date(row.created_at) >= monthStart) monthCredits += Number(j.estimate_credits ?? 0);
    } else if (j.status === "queued" || j.status === "running") row.remakes_pending++;
    else if (j.status === "failed") row.remakes_failed++;
  }

  return Response.json({
    hooks: Array.from(byHook.values()),
    month_credits: Math.round(monthCredits * 100) / 100,
  });
}

/**
 * POST /api/owner/hook-studio/hooks — create a hook from an uploaded reference.
 * Body: { lane, brief, creator, screen_mode, reference_path, reference_name,
 *         duration, width, height, trim_start?, trim_end? }
 */
export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { db, user } = auth;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  const lane = String(b.lane ?? "");
  if (!LANES.some((l) => l.id === lane)) return Response.json({ error: "Pick a lane" }, { status: 400 });
  const creator = String(b.creator ?? CREATORS[0]);
  if (!(CREATORS as readonly string[]).includes(creator)) {
    return Response.json({ error: "Unknown creator preset" }, { status: 400 });
  }
  const screenMode = String(b.screen_mode ?? "dark");
  if (!SCREEN_MODES.some((s) => s.id === screenMode)) {
    return Response.json({ error: "Unknown screen mode" }, { status: 400 });
  }
  const referencePath = typeof b.reference_path === "string" ? b.reference_path : "";
  if (!/^refs\/[0-9a-f-]{36}\.(mp4|mov)$/.test(referencePath)) {
    return Response.json({ error: "Upload the reference video first" }, { status: 400 });
  }
  const duration = Number(b.duration);
  const trimStart = Math.max(0, Number(b.trim_start ?? 0) || 0);
  let trimEnd = b.trim_end === null || b.trim_end === undefined ? null : Number(b.trim_end);
  if (trimEnd !== null && !(trimEnd > trimStart)) trimEnd = null;
  const spanEnd = trimEnd ?? (Number.isFinite(duration) ? duration : trimStart + MAX_REFERENCE_SECONDS);
  if (spanEnd - trimStart > MAX_REFERENCE_SECONDS) trimEnd = trimStart + MAX_REFERENCE_SECONDS;

  const { data, error } = await db
    .from("hook_studio_hooks")
    .insert({
      lane,
      brief: String(b.brief ?? "").slice(0, 2000),
      creator,
      screen_mode: screenMode,
      reference_path: referencePath,
      reference_name: typeof b.reference_name === "string" ? b.reference_name.slice(0, 200) : null,
      reference_duration: Number.isFinite(duration) ? duration : null,
      reference_width: Number.isFinite(Number(b.width)) ? Number(b.width) : null,
      reference_height: Number.isFinite(Number(b.height)) ? Number(b.height) : null,
      trim_start: trimStart,
      trim_end: trimEnd,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  return Response.json({ id: data.id });
}
