import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartoonBeatRow, CartoonHookRow, CartoonHookSummary, CartoonHookView, CartoonResolution } from "@/lib/cartoon/types";
import { deleteHook, loadHook, loadHooks, redo } from "@/lib/cartoon/views";
import { ANCHOR_VARIATIONS, MAX_VARIANTS, anchorCheckPrompt, anchorPrompt, checkPrompt, moveById, motionPrompt, stillPrompt } from "./engines";
import { planBroll } from "./planner";

/**
 * A science b-roll project is a cartoon_hooks row of kind "science". The app
 * plans it (Claude) and resets steps for redos; the Mac worker draws the
 * style anchor, every still, checks each still, animates and joins, exactly
 * as it does for Cartoon Hooks (worker/hook-worker.mjs, cartoonAdvance).
 */

export const loadProjects = (db: SupabaseClient): Promise<CartoonHookSummary[]> => loadHooks(db, "science");
export const loadProject = (db: SupabaseClient, id: string): Promise<CartoonHookView | null> => loadHook(db, id);
export const deleteProject = deleteHook;

export interface CreateProjects {
  text: string;
  direction: string;
  brand: string;
  resolution: CartoonResolution;
  variants: number;
  batch_id: string | null;
  created_by: string | null;
}

/** Insert one row per take in status "planning"; the caller plans them after responding. */
export async function createProjects(db: SupabaseClient, input: CreateProjects): Promise<{ ids: string[] } | { error: string }> {
  const text = input.text.trim();
  if (!text) return { error: "Write what to show first" };
  if (text.length > 2500) return { error: "Keep the text under 2,500 characters (a b-roll set is 10 to 60 seconds)" };
  const variants = Math.min(MAX_VARIANTS, Math.max(1, Math.round(input.variants) || 1));
  let first = 1;
  if (input.batch_id) {
    const { data } = await db.from("cartoon_hooks").select("variant").eq("batch_id", input.batch_id).order("variant", { ascending: false }).limit(1);
    first = ((data?.[0]?.variant as number | undefined) ?? 0) + 1;
  }
  const batch = input.batch_id ?? crypto.randomUUID();
  const direction = [input.brand.trim() ? `Brand: ${input.brand.trim()} (show its product form when a product is on screen).` : "", input.direction.trim()].filter(Boolean).join(" ").slice(0, 600);
  const rows = Array.from({ length: variants }, (_, i) => ({
    kind: "science",
    batch_id: batch,
    variant: first + i,
    title: "Planning…",
    script: text,
    style: "science",
    direction,
    resolution: input.resolution,
    voice_on: false,
    voice_provider: "higgsfield",
    created_by: input.created_by,
  }));
  const { data, error } = await db.from("cartoon_hooks").insert(rows).select("id");
  if (error || !data) return { error: error?.message ?? "Could not save" };
  return { ids: data.map((r) => r.id as string) };
}

/** Claude plans the beats; they are saved with their prompts, the anchor is the first scene, and the worker takes over. */
export async function planAndStart(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await db.from("cartoon_hooks").select("*").eq("id", projectId).eq("kind", "science").maybeSingle();
  if (!data) return "Not found";
  const project = data as CartoonHookRow;
  await db.from("cartoon_hooks").update({ status: "planning", error: null }).eq("id", projectId);
  const plan = await planBroll(db, { text: project.script, direction: project.direction, variant: project.variant });
  if ("error" in plan) {
    await db.from("cartoon_hooks").update({ status: "failed", error: plan.error }).eq("id", projectId);
    return plan.error;
  }
  await db.from("hook_studio_jobs").update({ status: "canceled" }).or("kind.like.cartoon_%,kind.eq.science_check").eq("status", "queued").eq("params->>hook_id", projectId);
  await db.from("cartoon_beats").delete().eq("hook_id", projectId);
  const { error } = await db.from("cartoon_beats").insert(
    plan.beats.map((b, idx) => {
      const move = moveById(b.move);
      return {
        hook_id: projectId,
        idx,
        line: b.line,
        seconds: b.seconds,
        style: "science",
        uses_character: true,
        scene: b.scene,
        motion: b.motion,
        move: move.id,
        still_prompt: stillPrompt(b.scene, move),
        motion_prompt: motionPrompt(b.motion, move),
        check_prompt: checkPrompt(b.scene, move),
      };
    })
  );
  if (error) {
    await db.from("cartoon_hooks").update({ status: "failed", error: error.message }).eq("id", projectId);
    return error.message;
  }
  const n = project.variant > 1 ? ` · take ${project.variant}` : "";
  await db
    .from("cartoon_hooks")
    .update({
      title: `${plan.title}${n}`,
      character_desc: plan.anchor_scene,
      character_prompt: anchorPrompt(plan.anchor_scene),
      anchor_check_prompt: anchorCheckPrompt(plan.anchor_scene),
      anchor_check_status: null,
      anchor_check_ok: null,
      anchor_check_notes: null,
      anchor_check_error: null,
      anchor_auto_redos: 0,
      anchor_approved: false,
      anchor_redos: 0,
      anchor_note: "",
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
    .eq("id", projectId);
  return null;
}

/** Draw a beat's still again, with the marketer's note in the prompt; the check and the clip follow on their own. */
export async function redoStill(db: SupabaseClient, projectId: string, beatId: string, note: string): Promise<string | null> {
  const { data } = await db.from("cartoon_beats").select("*").eq("id", beatId).eq("hook_id", projectId).maybeSingle();
  if (!data) return "Not found";
  const b = data as CartoonBeatRow;
  const move = moveById(b.move);
  const fix = note.trim().slice(0, 400);
  const { error } = await db
    .from("cartoon_beats")
    .update({
      still_prompt: fix ? `${stillPrompt(b.scene, move)} The marketer asks for this change: ${fix}.` : stillPrompt(b.scene, move),
      check_prompt: fix ? `${checkPrompt(b.scene, move)}\nThe marketer also asked for: ${fix}. Fail the still when that is missing.` : checkPrompt(b.scene, move),
      still_status: null,
      still_error: null,
      check_status: null,
      check_ok: null,
      check_notes: null,
      check_error: null,
      still_redos: 0,
      clip_status: null,
      clip_error: null,
    })
    .eq("id", beatId);
  if (error) return error.message;
  await db.from("cartoon_hooks").update({ status: "working", final_status: null, final_error: null, error: null }).eq("id", projectId);
  return null;
}

/** The marketer's OK on the anchor: the worker starts drawing the stills from it. */
export async function approveAnchor(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await db.from("cartoon_hooks").select("character_status").eq("id", projectId).eq("kind", "science").maybeSingle();
  if (!data) return "Not found";
  if (data.character_status !== "done") return "The anchor is not drawn yet";
  const { error } = await db.from("cartoon_hooks").update({ anchor_approved: true, status: "working", error: null }).eq("id", projectId);
  return error ? error.message : null;
}

/**
 * Draw the anchor again as a different take: the marketer's note when given,
 * else the next of the skill's variations. Every still is reset too and waits
 * for the new OK.
 */
export async function redoAnchor(db: SupabaseClient, projectId: string, note: string): Promise<string | null> {
  const { data: row } = await db.from("cartoon_hooks").select("anchor_redos, character_desc").eq("id", projectId).eq("kind", "science").maybeSingle();
  if (!row) return "Not found";
  const scene = String(row.character_desc ?? "").replace(/^Style anchor: /, "");
  const redos = (Number(row.anchor_redos) || 0) + 1;
  const fix = note.trim().slice(0, 400);
  const take = fix ? `A different take from the last one, as the marketer asks: ${fix}.` : `${ANCHOR_VARIATIONS[(redos - 1) % ANCHOR_VARIATIONS.length]} Clearly different from a plain textbook plate.`;
  const { error } = await db
    .from("cartoon_hooks")
    .update({
      character_prompt: anchorPrompt(scene, take),
      anchor_check_prompt: anchorCheckPrompt(scene),
      anchor_check_status: null,
      anchor_check_ok: null,
      anchor_check_notes: null,
      anchor_check_error: null,
      anchor_auto_redos: 0,
      anchor_note: fix,
      anchor_redos: redos,
      anchor_approved: false,
      character_status: null,
      character_error: null,
      status: "working",
      final_status: null,
      final_error: null,
      error: null,
    })
    .eq("id", projectId);
  if (error) return error.message;
  await db.from("cartoon_beats").update({ still_status: null, still_error: null, check_status: null, check_ok: null, check_notes: null, check_error: null, still_redos: 0, clip_status: null, clip_error: null }).eq("hook_id", projectId);
  return null;
}

/** Animate the same still again, or join again. */
export const redoStep = (db: SupabaseClient, projectId: string, what: "clip" | "join", beatId: string | null) => redo(db, projectId, what, beatId);
