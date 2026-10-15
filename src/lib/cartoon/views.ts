import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { MAX_VARIANTS, characterPrompt, motionPrompt, stillPrompt } from "./engines";
import { voiceElevenLabsBeats } from "./elevenlabs";
import { planHook } from "./planner";
import type { BeatStyle, CartoonBeatRow, CartoonBeatView, CartoonHookRow, CartoonHookSummary, CartoonHookView, CartoonResolution, CartoonStyle, VoiceProvider } from "./types";

/**
 * The app plans a hook (Claude) and resets steps for redos. The Mac worker
 * does the rest: for every hook in status "working" it queues each step whose
 * status is null and whose inputs are ready (worker/hook-worker.mjs,
 * cartoonAdvance), so a redo here is only "set the status back to null".
 */

const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (Number(b) || 0), 0);

function summarize(h: CartoonHookRow, beats: CartoonBeatRow[], signed: Map<string, string>): CartoonHookSummary {
  const sorted = [...beats].sort((a, b) => a.idx - b.idx);
  const cover = sorted.find((b) => b.still_preview_path || b.still_path);
  return {
    ...h,
    character_url: (h.character_preview_path && signed.get(h.character_preview_path)) || (h.character_path && signed.get(h.character_path)) || null,
    final_url: h.final_path ? signed.get(h.final_path) ?? null : null,
    cover_url: cover ? signed.get(cover.still_preview_path ?? "") ?? signed.get(cover.still_path ?? "") ?? null : null,
    beats_total: beats.length,
    stills_done: beats.filter((b) => b.still_status === "done").length,
    clips_done: beats.filter((b) => b.clip_status === "done").length,
    credits: Math.round((Number(h.character_credits) || 0) + sum(beats.flatMap((b) => [b.still_credits, b.clip_credits, b.voice_credits])) * 100) / 100,
  };
}

export async function loadHooks(db: SupabaseClient): Promise<CartoonHookSummary[]> {
  const { data } = await db.from("cartoon_hooks").select("*").order("created_at", { ascending: false }).limit(100);
  const hooks = (data ?? []) as CartoonHookRow[];
  if (hooks.length === 0) return [];
  const { data: beatRows } = await db
    .from("cartoon_beats")
    .select("hook_id, idx, still_status, clip_status, still_path, still_preview_path, still_credits, clip_credits, voice_credits")
    .in("hook_id", hooks.map((h) => h.id));
  const beats = (beatRows ?? []) as CartoonBeatRow[];
  const byHook = new Map<string, CartoonBeatRow[]>();
  for (const b of beats) byHook.set(b.hook_id, [...(byHook.get(b.hook_id) ?? []), b]);
  const covers = hooks.map((h) => (byHook.get(h.id) ?? []).sort((a, b) => a.idx - b.idx).find((b) => b.still_preview_path || b.still_path));
  const signed = await signBoardPaths(db, [
    ...hooks.flatMap((h) => [h.character_preview_path ?? h.character_path, h.final_path]),
    ...covers.map((b) => b?.still_preview_path ?? b?.still_path),
  ]);
  return hooks.map((h) => summarize(h, byHook.get(h.id) ?? [], signed));
}

export async function loadHook(db: SupabaseClient, id: string): Promise<CartoonHookView | null> {
  const { data } = await db.from("cartoon_hooks").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const hook = data as CartoonHookRow;
  const { data: beatRows } = await db.from("cartoon_beats").select("*").eq("hook_id", id).order("idx");
  const beats = (beatRows ?? []) as CartoonBeatRow[];
  const signed = await signBoardPaths(db, [
    hook.character_path,
    hook.character_preview_path,
    hook.final_path,
    ...beats.flatMap((b) => [b.still_path, b.still_preview_path, b.clip_path, b.voice_path]),
  ]);
  const views: CartoonBeatView[] = beats.map((b) => ({
    ...b,
    still_url: b.still_path ? signed.get(b.still_path) ?? null : null,
    still_preview_url: (b.still_preview_path && signed.get(b.still_preview_path)) || (b.still_path && signed.get(b.still_path)) || null,
    clip_url: b.clip_path ? signed.get(b.clip_path) ?? null : null,
    voice_url: b.voice_path ? signed.get(b.voice_path) ?? null : null,
  }));
  return { ...summarize(hook, beats, signed), beats: views };
}

export interface CreateHooks {
  script: string;
  style: CartoonStyle;
  direction: string;
  resolution: CartoonResolution;
  voice_on: boolean;
  voice_provider: VoiceProvider;
  voice_id: string | null;
  voice_type: string | null;
  voice_name: string | null;
  variants: number;
  batch_id: string | null;
  created_by: string | null;
}

/** Insert one row per variant in status "planning"; the caller plans them after responding. */
export async function createHooks(db: SupabaseClient, input: CreateHooks): Promise<{ ids: string[] } | { error: string }> {
  const script = input.script.trim();
  if (!script) return { error: "Paste the script first" };
  if (script.length > 2500) return { error: "Keep the script under 2,500 characters (a hook is 10 to 30 seconds)" };
  if (input.voice_on && (!input.voice_id || (input.voice_provider === "higgsfield" && !input.voice_type))) return { error: "Pick a voice, or turn the voiceover off" };
  const variants = Math.min(MAX_VARIANTS, Math.max(1, Math.round(input.variants) || 1));

  // Another take of an existing batch continues its variant numbering.
  let first = 1;
  if (input.batch_id) {
    const { data } = await db.from("cartoon_hooks").select("variant").eq("batch_id", input.batch_id).order("variant", { ascending: false }).limit(1);
    first = ((data?.[0]?.variant as number | undefined) ?? 0) + 1;
  }
  const batch = input.batch_id ?? crypto.randomUUID();
  const rows = Array.from({ length: variants }, (_, i) => ({
    batch_id: batch,
    variant: first + i,
    title: "Planning…",
    script,
    style: input.style,
    direction: input.direction.trim().slice(0, 600),
    resolution: input.resolution,
    voice_on: input.voice_on,
    voice_provider: input.voice_provider,
    voice_id: input.voice_on ? input.voice_id : null,
    voice_type: input.voice_on ? input.voice_type : null,
    voice_name: input.voice_on ? input.voice_name : null,
    created_by: input.created_by,
  }));
  const { data, error } = await db.from("cartoon_hooks").insert(rows).select("id");
  if (error || !data) return { error: error?.message ?? "Could not save" };
  return { ids: data.map((r) => r.id as string) };
}

/** Claude splits the script; the beats are saved with their prompts and the hook goes to the worker. */
export async function planAndStart(db: SupabaseClient, hookId: string): Promise<string | null> {
  const { data } = await db.from("cartoon_hooks").select("*").eq("id", hookId).maybeSingle();
  if (!data) return "Not found";
  const hook = data as CartoonHookRow;
  await db.from("cartoon_hooks").update({ status: "planning", error: null }).eq("id", hookId);
  const plan = await planHook(db, { script: hook.script, style: hook.style, direction: hook.direction, variant: hook.variant });
  if ("error" in plan) {
    await db.from("cartoon_hooks").update({ status: "failed", error: plan.error }).eq("id", hookId);
    return plan.error;
  }
  // A replan replaces the beats: drop work queued for the old ones.
  await db.from("hook_studio_jobs").update({ status: "canceled" }).like("kind", "cartoon_%").eq("status", "queued").eq("params->>hook_id", hookId);
  await db.from("cartoon_beats").delete().eq("hook_id", hookId);
  const { error } = await db.from("cartoon_beats").insert(
    plan.beats.map((b, idx) => ({
      hook_id: hookId,
      idx,
      line: b.line,
      seconds: b.seconds,
      style: b.style,
      uses_character: b.uses_character,
      scene: b.scene,
      motion: b.motion,
      still_prompt: stillPrompt(b.style, b.scene, b.uses_character),
      motion_prompt: motionPrompt(b.style, b.motion),
    }))
  );
  if (error) {
    await db.from("cartoon_hooks").update({ status: "failed", error: error.message }).eq("id", hookId);
    return error.message;
  }
  const n = hook.variant > 1 ? ` · take ${hook.variant}` : "";
  await db
    .from("cartoon_hooks")
    .update({
      title: `${plan.title}${n}`,
      character_desc: plan.character.needed ? plan.character.description : "",
      character_prompt: plan.character.needed ? characterPrompt(plan.character.style, plan.character.description) : null,
      character_status: null,
      character_path: null,
      character_preview_path: null,
      character_error: null,
      final_status: null,
      final_path: null,
      final_error: null,
      status: "working",
      error: null,
    })
    .eq("id", hookId);
  // The team's ElevenLabs lines are made here; the worker makes everything else.
  await voiceElevenLabsBeats(db, hookId);
  return null;
}

/** Edit a beat's words, length, look or motion; the prompts are rebuilt. The image or clip is redone only when asked. */
export async function updateBeat(
  db: SupabaseClient,
  beatId: string,
  patch: { line?: string; seconds?: number; scene?: string; motion?: string; style?: BeatStyle; uses_character?: boolean }
): Promise<string | null> {
  const { data } = await db.from("cartoon_beats").select("*").eq("id", beatId).maybeSingle();
  if (!data) return "Not found";
  const b = { ...(data as CartoonBeatRow) };
  if (typeof patch.line === "string") b.line = patch.line.trim().slice(0, 400);
  if (typeof patch.seconds === "number" && Number.isFinite(patch.seconds)) b.seconds = Math.round(Math.min(6, Math.max(1, patch.seconds)) * 10) / 10;
  if (typeof patch.scene === "string" && patch.scene.trim()) b.scene = patch.scene.trim().slice(0, 1200);
  if (typeof patch.motion === "string" && patch.motion.trim()) b.motion = patch.motion.trim().slice(0, 600);
  if (patch.style) b.style = patch.style;
  if (typeof patch.uses_character === "boolean") b.uses_character = patch.uses_character;
  const { error } = await db
    .from("cartoon_beats")
    .update({
      line: b.line,
      seconds: b.seconds,
      scene: b.scene,
      motion: b.motion,
      style: b.style,
      uses_character: b.uses_character,
      still_prompt: stillPrompt(b.style, b.scene, b.uses_character),
      motion_prompt: motionPrompt(b.style, b.motion),
    })
    .eq("id", beatId);
  return error ? error.message : null;
}

export type Redo = "still" | "clip" | "voice" | "character" | "join";

/**
 * Put a step back to "not started"; the worker picks it up within seconds.
 * Downstream steps are reset too (a new image needs a new clip; anything new
 * needs a new join). Old files stay on screen until the new ones land.
 */
export async function redo(db: SupabaseClient, hookId: string, what: Redo, beatId: string | null): Promise<string | null> {
  const { data } = await db.from("cartoon_hooks").select("*").eq("id", hookId).maybeSingle();
  if (!data) return "Not found";
  const hook = data as CartoonHookRow;
  if (hook.status === "planning") return "Still planning";
  const reset = (step: "still" | "clip" | "voice") => ({ [`${step}_status`]: null, [`${step}_error`]: null });

  if (what === "character") {
    if (!hook.character_prompt) return "This hook has no main character";
    await db.from("cartoon_beats").update({ ...reset("still"), ...reset("clip") }).eq("hook_id", hookId).eq("uses_character", true);
    await db.from("cartoon_hooks").update({ character_status: null, character_error: null }).eq("id", hookId);
  } else if (what === "still" || what === "clip" || what === "voice") {
    if (!beatId) return "Which beat?";
    const patch = what === "still" ? { ...reset("still"), ...reset("clip") } : reset(what);
    const { error } = await db.from("cartoon_beats").update(patch).eq("id", beatId).eq("hook_id", hookId);
    if (error) return error.message;
  } else if (what !== "join") {
    return "Unknown step";
  }
  await db.from("cartoon_hooks").update({ status: "working", final_status: null, final_error: null, error: null }).eq("id", hookId);
  if (what === "voice") await voiceElevenLabsBeats(db, hookId);
  return null;
}

/** Remove a hook, its beats and files; queued jobs are canceled. */
export async function deleteHook(db: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await db.from("cartoon_hooks").select("id").eq("id", id).maybeSingle();
  if (!data) return "Not found";
  await db.from("hook_studio_jobs").update({ status: "canceled" }).like("kind", "cartoon_%").eq("status", "queued").eq("params->>hook_id", id);
  const { data: files } = await db.storage.from(BOARD_BUCKET).list(`cartoon-hooks/${id}`, { limit: 1000 });
  const paths = (files ?? []).map((f) => `cartoon-hooks/${id}/${f.name}`);
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  const { error } = await db.from("cartoon_hooks").delete().eq("id", id);
  return error ? error.message : null;
}
