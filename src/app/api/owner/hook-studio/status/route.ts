import { requireOwner } from "@/lib/hook-studio/auth";
import type { WorkerStatus } from "@/lib/hook-studio/types";

export const dynamic = "force-dynamic";

/** app_settings row the Mac worker heartbeats into (see worker/hook-worker.mjs). */
const WORKER_STATUS_KEY = "hook_worker_status";
/** The worker heartbeats every loop; two minutes of silence means offline. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** GET — is the Mac worker alive, and how many jobs wait for it. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { db } = auth;

  const [{ data: row }, { count: queued }, { count: running }] = await Promise.all([
    db.from("app_settings").select("value").eq("key", WORKER_STATUS_KEY).maybeSingle(),
    db.from("hook_studio_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    db.from("hook_studio_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
  ]);

  let hb: { last_seen?: string; credits?: number; plan?: string; worker?: string; version?: string } = {};
  try {
    hb = row?.value ? JSON.parse(row.value as string) : {};
  } catch {
    hb = {};
  }
  const lastSeen = hb.last_seen ?? null;
  const online = !!lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;

  const status: WorkerStatus = {
    online,
    last_seen: lastSeen,
    credits: typeof hb.credits === "number" ? hb.credits : null,
    plan: hb.plan ?? null,
    worker: hb.worker ?? null,
    version: hb.version ?? null,
    queued: queued ?? 0,
    running: running ?? 0,
  };
  return Response.json(status);
}
