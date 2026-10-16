import type { SupabaseClient } from "@supabase/supabase-js";
import { signBoardPaths } from "@/lib/marketing-board/storage";
import { toDnaView } from "./dna";
import type { BoardVideo, DnaView, RunRow, RunView, ScriptRow, StudioPage } from "./types";

async function loadRuns(db: SupabaseClient, itemId: string | null): Promise<RunView[]> {
  let q = db.from("script_studio_runs").select("*").order("created_at", { ascending: false }).limit(30);
  if (itemId) q = q.eq("item_id", itemId);
  const { data: runRows } = await q;
  const runs = (runRows ?? []) as RunRow[];
  if (runs.length === 0) return [];
  const { data: scriptRows } = await db.from("script_studio_scripts").select("*").in("run_id", runs.map((r) => r.id)).order("idx");
  const scripts = (scriptRows ?? []) as ScriptRow[];
  return runs.map((run) => ({ ...run, scripts: scripts.filter((s) => s.run_id === run.id) }));
}

async function loadBoardVideos(db: SupabaseClient): Promise<BoardVideo[]> {
  const { data } = await db.from("marketing_board_items").select("id, title, author, duration, thumb_path").eq("kind", "video").not("video_path", "is", null).order("created_at", { ascending: false }).limit(80);
  type Row = { id: string; title: string | null; author: string | null; duration: number | null; thumb_path: string | null };
  const rows = (data ?? []) as Row[];
  const signed = await signBoardPaths(db, rows.map((r) => r.thumb_path));
  return rows.map((r) => ({ id: r.id, title: r.title ?? "Video", author: r.author, seconds: r.duration ? Math.round(r.duration) : null, thumb_url: r.thumb_path ? signed.get(r.thumb_path) ?? null : null }));
}

export async function loadStudioPage(db: SupabaseClient, itemId: string | null): Promise<StudioPage> {
  const [itemRow, { data: storeRows }, { data: kits }, { data: dnaRows }, board_videos, runs] = await Promise.all([
    itemId ? db.from("marketing_board_items").select("id, title, store, video_path").eq("id", itemId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    db.from("shopify_stores").select("name").eq("is_active", true).order("name"),
    db.from("remake_brand_kits").select("store, profile"),
    db.from("script_brand_dna").select("store, dna, built_from, built_at"),
    loadBoardVideos(db),
    loadRuns(db, itemId),
  ]);
  const dna: Record<string, DnaView> = {};
  for (const row of (dnaRows ?? []) as Array<{ store: string; dna: string; built_from: unknown; built_at: string }>) dna[row.store] = toDnaView(row);
  return {
    item: itemRow ? { id: itemRow.id as string, title: (itemRow.title as string | null) ?? null, store: (itemRow.store as string | null) ?? null, has_video: !!itemRow.video_path } : null,
    stores: ((storeRows ?? []) as Array<{ name: string }>).map((s) => s.name),
    profiled: ((kits ?? []) as Array<{ store: string; profile: string | null }>).filter((k) => (k.profile ?? "").trim()).map((k) => k.store),
    dna,
    board_videos,
    runs,
  };
}

/** Keep a script: it lands in the board card's notes thread, where the editor reads it. */
export async function keepScript(db: SupabaseClient, id: string, authorId: string): Promise<string | null> {
  const { data } = await db.from("script_studio_scripts").select("id, title, script_text, status, script_studio_runs!inner(item_id, store)").eq("id", id).maybeSingle();
  if (!data) return "Not found";
  const r = data as unknown as ScriptRow & { script_studio_runs: { item_id: string | null; store: string } };
  if (r.status !== "done" || !r.script_text) return "Not finished";
  const itemId = r.script_studio_runs.item_id;
  if (itemId) {
    const { error } = await db.from("marketing_board_comments").insert({ item_id: itemId, author_id: authorId, body: `Script Generator · ${r.script_studio_runs.store} · ${r.title}\n\n${r.script_text}`.slice(0, 20000) });
    if (error) return error.message;
  }
  const { error } = await db.from("script_studio_scripts").update({ kept: true }).eq("id", id);
  return error ? error.message : null;
}

export async function deleteRun(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("script_studio_runs").delete().eq("id", id);
  return error ? error.message : null;
}
