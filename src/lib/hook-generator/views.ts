import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_BUCKET, signBoardPaths } from "@/lib/marketing-board/storage";
import { HOOK_BUCKET, signPaths as signHookPaths } from "@/lib/hook-studio/storage";
import { MAX_REFS, MAX_VARIANTS, beatSeconds, clipSecondsFor, hasHeadTap, isBeatKind, motionPrompt, ownStillPrompt, stillPrompt, validClipSeconds } from "./engines";
import { planHook } from "./planner";
import type {
  BeatKind,
  HookRef,
  HookRefView,
  HookgenBeatRow,
  HookgenBeatView,
  HookgenHookRow,
  HookgenSummary,
  HookgenView,
  ImageModel,
  RefRole,
  VideoModel,
} from "./types";

/**
 * The app plans a hook (Claude), records approvals and resets steps for
 * redos. The Mac worker does the rest: for every hook in "stills" or
 * "working" it queues each step whose status is null and whose inputs are
 * ready (worker/hook-worker.mjs, hookgenAdvance).
 */

const REF_PATH = /^hook-generator\/refs\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
const ROLES: RefRole[] = ["expert", "client", "setting", "product", "style"];
const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (Number(b) || 0), 0);

/** Signed URLs for paths in both buckets the references can come from. */
async function signAll(db: SupabaseClient, board: Array<string | null | undefined>, refs: HookRef[]): Promise<Map<string, string>> {
  const [b, h] = await Promise.all([
    signBoardPaths(db, [...board, ...refs.filter((r) => r.bucket !== HOOK_BUCKET).map((r) => r.path)]),
    signHookPaths(db, refs.filter((r) => r.bucket === HOOK_BUCKET).map((r) => r.path)),
  ]);
  return new Map([...b, ...h]);
}

function summarize(h: HookgenHookRow, beats: HookgenBeatRow[], signed: Map<string, string>): HookgenSummary {
  const sorted = [...beats].sort((a, b) => a.idx - b.idx);
  const cover = sorted.find((b) => b.still_preview_path || b.still_path);
  return {
    ...h,
    final_url: h.final_path ? signed.get(h.final_path) ?? null : null,
    cover_url: cover ? signed.get(cover.still_preview_path ?? "") ?? signed.get(cover.still_path ?? "") ?? null : null,
    beats_total: beats.length,
    stills_done: beats.filter((b) => b.still_status === "done").length,
    approved: beats.filter((b) => b.approved).length,
    clips_done: beats.filter((b) => b.clip_status === "done").length,
    checks_done: beats.filter((b) => b.check_status === "done" || b.check_status === "failed").length,
    credits: Math.round(sum(beats.flatMap((b) => [b.still_credits, b.clip_credits])) * 100) / 100,
  };
}

export async function loadHooks(db: SupabaseClient): Promise<HookgenSummary[]> {
  const { data } = await db.from("hookgen_hooks").select("*").order("created_at", { ascending: false }).limit(100);
  const hooks = (data ?? []) as HookgenHookRow[];
  if (hooks.length === 0) return [];
  const { data: beatRows } = await db
    .from("hookgen_beats")
    .select("hook_id, idx, approved, still_status, clip_status, check_status, still_path, still_preview_path, still_credits, clip_credits")
    .in("hook_id", hooks.map((h) => h.id));
  const beats = (beatRows ?? []) as HookgenBeatRow[];
  const byHook = new Map<string, HookgenBeatRow[]>();
  for (const b of beats) byHook.set(b.hook_id, [...(byHook.get(b.hook_id) ?? []), b]);
  const covers = hooks.map((h) => (byHook.get(h.id) ?? []).sort((a, b) => a.idx - b.idx).find((b) => b.still_preview_path || b.still_path));
  const signed = await signBoardPaths(db, [...hooks.map((h) => h.final_path), ...covers.map((b) => b?.still_preview_path ?? b?.still_path)]);
  return hooks.map((h) => summarize(h, byHook.get(h.id) ?? [], signed));
}

export async function loadHook(db: SupabaseClient, id: string): Promise<HookgenView | null> {
  const { data } = await db.from("hookgen_hooks").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const hook = data as HookgenHookRow;
  const { data: beatRows } = await db.from("hookgen_beats").select("*").eq("hook_id", id).order("idx");
  const beats = (beatRows ?? []) as HookgenBeatRow[];
  const signed = await signAll(db, [hook.final_path, ...beats.flatMap((b) => [b.still_path, b.still_preview_path, b.clip_path])], hook.refs ?? []);
  const views: HookgenBeatView[] = beats.map((b) => ({
    ...b,
    still_url: b.still_path ? signed.get(b.still_path) ?? null : null,
    still_preview_url: (b.still_preview_path && signed.get(b.still_preview_path)) || (b.still_path && signed.get(b.still_path)) || null,
    clip_url: b.clip_path ? signed.get(b.clip_path) ?? null : null,
  }));
  const refsView: HookRefView[] = (hook.refs ?? []).map((r) => ({ ...r, url: signed.get(r.path) ?? null }));
  return { ...summarize(hook, beats, signed), refs_view: refsView, beats: views };
}

/** A reference as the page sends it: an uploaded photo, or a person from the library. */
export interface RefInput {
  path?: string;
  person_id?: string;
  role: RefRole;
  name?: string;
}

export interface CreateHooks {
  direction: string;
  line: string;
  kinds: BeatKind[];
  refs: RefInput[];
  image_model: ImageModel;
  video_model: VideoModel;
  /** A clip length for every beat; null = fit each beat's line. */
  clip_seconds: number | null;
  /** Wait after planning so the marketer can read and edit the prompts before images are drawn. */
  hold_stills: boolean;
  variants: number;
  batch_id: string | null;
  created_by: string | null;
}

async function resolveRefs(db: SupabaseClient, input: RefInput[]): Promise<HookRef[] | { error: string }> {
  const out: HookRef[] = [];
  for (const r of input.slice(0, MAX_REFS)) {
    const role = ROLES.includes(r.role) ? r.role : "style";
    if (r.person_id) {
      const { data } = await db.from("remake_people").select("bucket, path, name").eq("id", r.person_id).maybeSingle();
      if (!data) return { error: "A picked person is no longer in the library" };
      out.push({ bucket: (data.bucket as string) || BOARD_BUCKET, path: data.path as string, role, name: (data.name as string) || "" });
    } else if (r.path && REF_PATH.test(r.path)) {
      out.push({ bucket: BOARD_BUCKET, path: r.path, role, name: (r.name ?? "").slice(0, 120) });
    } else {
      return { error: "A reference image did not upload; add it again" };
    }
  }
  return out;
}

/** Insert one row per variant in status "planning"; the caller plans them after responding. */
export async function createHooks(db: SupabaseClient, input: CreateHooks): Promise<{ ids: string[] } | { error: string }> {
  // No head-tap move is fine: the hook is then planned from the direction alone.
  const kinds = input.kinds.filter(isBeatKind);
  if (kinds.length === 0 && !input.direction.trim()) return { error: "Describe what you want, or pick a head-tap move" };
  if (!input.direction.trim() && input.refs.length === 0) return { error: "Add reference images or describe what you want" };
  if (input.line.length > 400) return { error: "Keep the spoken line under 400 characters (a hook is 3 to 8 seconds)" };
  const refs = await resolveRefs(db, input.refs);
  if ("error" in refs) return refs;
  const variants = Math.min(MAX_VARIANTS, Math.max(1, Math.round(input.variants) || 1));

  // Another take of an existing batch continues its variant numbering.
  let first = 1;
  if (input.batch_id) {
    const { data } = await db.from("hookgen_hooks").select("variant").eq("batch_id", input.batch_id).order("variant", { ascending: false }).limit(1);
    first = ((data?.[0]?.variant as number | undefined) ?? 0) + 1;
  }
  const batch = input.batch_id ?? crypto.randomUUID();
  const rows = Array.from({ length: variants }, (_, i) => ({
    batch_id: batch,
    variant: first + i,
    title: "Planning…",
    direction: input.direction.trim().slice(0, 1200),
    line: input.line.trim(),
    beat_kinds: kinds,
    refs,
    image_model: input.image_model,
    video_model: input.video_model,
    clip_seconds: validClipSeconds(input.video_model, input.clip_seconds),
    hold_stills: input.hold_stills,
    created_by: input.created_by,
  }));
  const { data, error } = await db.from("hookgen_hooks").insert(rows).select("id");
  if (error || !data) return { error: error?.message ?? "Could not save" };
  return { ids: data.map((r) => r.id as string) };
}

/** One more take from a hook's own inputs (same references, direction, line and models), numbered after the batch's last. */
export async function anotherTake(db: SupabaseClient, hookId: string, createdBy: string | null): Promise<{ id: string } | { error: string }> {
  const { data } = await db.from("hookgen_hooks").select("*").eq("id", hookId).maybeSingle();
  if (!data) return { error: "Not found" };
  const h = data as HookgenHookRow;
  const { data: last } = await db.from("hookgen_hooks").select("variant").eq("batch_id", h.batch_id).order("variant", { ascending: false }).limit(1);
  const { data: row, error } = await db
    .from("hookgen_hooks")
    .insert({
      batch_id: h.batch_id,
      variant: ((last?.[0]?.variant as number | undefined) ?? h.variant) + 1,
      title: "Planning…",
      direction: h.direction,
      line: h.line,
      beat_kinds: h.beat_kinds,
      refs: h.refs,
      image_model: h.image_model,
      video_model: h.video_model,
      clip_seconds: h.clip_seconds,
      hold_stills: h.hold_stills,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "Could not save" };
  return { id: row.id as string };
}

/** Claude plans the beats; they are saved with their prompts and the worker draws the starting images (unless the hook is held). */
export async function planAndStart(db: SupabaseClient, hookId: string): Promise<string | null> {
  const { data } = await db.from("hookgen_hooks").select("*").eq("id", hookId).maybeSingle();
  if (!data) return "Not found";
  const hook = data as HookgenHookRow;
  await db.from("hookgen_hooks").update({ status: "planning", error: null }).eq("id", hookId);
  const signed = await signAll(db, [], hook.refs ?? []);
  const plan = await planHook(db, {
    direction: hook.direction,
    line: hook.line,
    kinds: hook.beat_kinds,
    refs: (hook.refs ?? []).map((r) => ({ role: r.role, url: signed.get(r.path) ?? null })),
    variant: hook.variant,
  });
  if ("error" in plan) {
    await db.from("hookgen_hooks").update({ status: "failed", error: plan.error }).eq("id", hookId);
    return plan.error;
  }
  // A replan replaces the beats: drop work queued for the old ones.
  await db.from("hook_studio_jobs").update({ status: "canceled" }).like("kind", "hookgen_%").eq("status", "queued").eq("params->>hook_id", hookId);
  await db.from("hookgen_beats").delete().eq("hook_id", hookId);
  const roles = (hook.refs ?? []).map((r) => r.role);
  const { error } = await db.from("hookgen_beats").insert(
    plan.beats.map((b, idx) => {
      const seconds = beatSeconds(b.line);
      // No moves picked: every beat is the marketer's own, without the head-tap rule.
      const kind = hook.beat_kinds[idx] ?? "custom";
      const headTap = hasHeadTap(kind);
      const chosen = validClipSeconds(hook.video_model, hook.clip_seconds);
      return {
        hook_id: hookId,
        idx,
        kind,
        line: b.line,
        seconds,
        clip_seconds: chosen ?? clipSecondsFor(hook.video_model, seconds),
        clip_seconds_set: chosen !== null,
        scene: b.scene,
        motion: b.motion,
        still_prompt: stillPrompt(b.scene, roles, "", headTap),
        motion_prompt: motionPrompt({ motion: b.motion, line: b.line, voice: plan.voice, model: hook.video_model, headTap }),
      };
    })
  );
  if (error) {
    await db.from("hookgen_hooks").update({ status: "failed", error: error.message }).eq("id", hookId);
    return error.message;
  }
  const n = hook.variant > 1 ? ` · take ${hook.variant}` : "";
  await db
    .from("hookgen_hooks")
    .update({ title: `${plan.title}${n}`, voice: plan.voice, status: "stills", error: null, final_status: null, final_path: null, final_error: null })
    .eq("id", hookId);
  return null;
}

const stepReset = (step: "still" | "clip" | "check") => ({ [`${step}_status`]: null, [`${step}_error`]: null });
const checkReset = { check_status: null, check_ok: null, check_notes: null, check_error: null };

/** Once every beat is approved the worker animates them; until then it only draws starting images. */
async function startWhenAllApproved(db: SupabaseClient, hookId: string): Promise<void> {
  const { data } = await db.from("hookgen_beats").select("approved, still_status").eq("hook_id", hookId);
  const beats = (data ?? []) as Array<{ approved: boolean; still_status: string | null }>;
  const ready = beats.length > 0 && beats.every((b) => b.approved && b.still_status === "done");
  await db
    .from("hookgen_hooks")
    .update(ready ? { status: "working", error: null } : { status: "stills" })
    .eq("id", hookId)
    .in("status", ["stills", "working", "done"]);
}

/** Approve one starting image (or take the approval back while the clip has not started). */
export async function approveBeat(db: SupabaseClient, hookId: string, beatId: string, approved: boolean): Promise<string | null> {
  const { data } = await db.from("hookgen_beats").select("approved, still_status, clip_status").eq("id", beatId).eq("hook_id", hookId).maybeSingle();
  if (!data) return "Not found";
  if (data.approved === approved) return null;
  if (approved && data.still_status !== "done") return "Wait for the image first";
  if (!approved && data.clip_status) return "This beat is already animating; redo its image instead";
  await db.from("hookgen_beats").update({ approved }).eq("id", beatId);
  await startWhenAllApproved(db, hookId);
  return null;
}

/** Approve every finished starting image of a hook at once. */
export async function approveAll(db: SupabaseClient, hookId: string): Promise<string | null> {
  const { data } = await db.from("hookgen_beats").select("id, approved, still_status").eq("hook_id", hookId);
  const beats = (data ?? []) as Array<{ id: string; approved: boolean; still_status: string | null }>;
  if (beats.length === 0) return "Nothing to approve yet";
  if (beats.every((b) => b.approved)) return null;
  if (beats.some((b) => b.still_status !== "done")) return "Wait for every image to finish";
  await db.from("hookgen_beats").update({ approved: true }).eq("hook_id", hookId);
  await startWhenAllApproved(db, hookId);
  return null;
}

/**
 * Draw a beat's starting image again, with the marketer's fix in words when
 * given. Its approval, clip and check are reset, and the hook waits for
 * approval again; the other beats keep what they have.
 */
export async function redoStill(db: SupabaseClient, hookId: string, beatId: string, fix: string): Promise<string | null> {
  const [{ data: h }, { data: b }] = await Promise.all([
    db.from("hookgen_hooks").select("*").eq("id", hookId).maybeSingle(),
    db.from("hookgen_beats").select("*").eq("id", beatId).eq("hook_id", hookId).maybeSingle(),
  ]);
  if (!h || !b) return "Not found";
  const hook = h as HookgenHookRow;
  const beat = b as HookgenBeatRow;
  if (hook.status === "planning") return "Still planning";
  const text = fix.trim().slice(0, 500);
  await db
    .from("hookgen_beats")
    .update({
      fix: text,
      still_prompt: beat.still_custom ? ownStillPrompt(beat.scene, text) : stillPrompt(beat.scene, (hook.refs ?? []).map((r) => r.role), text, hasHeadTap(beat.kind)),
      approved: false,
      ...stepReset("still"),
      ...stepReset("clip"),
      ...checkReset,
      rerolls: 0,
    })
    .eq("id", beatId);
  await db.from("hookgen_hooks").update({ status: "stills", final_status: null, final_error: null, error: null }).eq("id", hookId);
  return null;
}

/**
 * Change what the expert says in a beat. Its timing and the clip prompt follow;
 * a clip already made from the old words is made again (and the hook joined again).
 */
export async function setLine(db: SupabaseClient, hookId: string, beatId: string, line: string): Promise<string | null> {
  const [{ data: h }, { data: b }] = await Promise.all([
    db.from("hookgen_hooks").select("*").eq("id", hookId).maybeSingle(),
    db.from("hookgen_beats").select("*").eq("id", beatId).eq("hook_id", hookId).maybeSingle(),
  ]);
  if (!h || !b) return "Not found";
  const hook = h as HookgenHookRow;
  const beat = b as HookgenBeatRow;
  const text = line.trim().slice(0, 300);
  if (text === beat.line) return null;
  const seconds = beatSeconds(text);
  const redo = beat.clip_status !== null;
  await db
    .from("hookgen_beats")
    .update({
      line: text,
      seconds,
      clip_seconds: beat.clip_seconds_set ? beat.clip_seconds : clipSecondsFor(hook.video_model, seconds),
      // The marketer's own clip prompt is used as written; the words are theirs to put in it.
      motion_prompt: beat.motion_custom ? beat.motion_prompt : motionPrompt({ motion: beat.motion, line: text, voice: hook.voice, model: hook.video_model, headTap: hasHeadTap(beat.kind) }),
      ...(redo ? { ...stepReset("clip"), ...checkReset, rerolls: 0 } : {}),
    })
    .eq("id", beatId);
  if (redo) {
    await db.from("hookgen_hooks").update({ final_status: null, final_error: null }).eq("id", hookId);
    // A finished hook goes back to work so the worker makes the new clip.
    await startWhenAllApproved(db, hookId);
  }
  return null;
}

/** A beat and its hook, for the edits below. */
async function beatAndHook(db: SupabaseClient, hookId: string, beatId: string): Promise<{ hook: HookgenHookRow; beat: HookgenBeatRow } | null> {
  const [{ data: h }, { data: b }] = await Promise.all([
    db.from("hookgen_hooks").select("*").eq("id", hookId).maybeSingle(),
    db.from("hookgen_beats").select("*").eq("id", beatId).eq("hook_id", hookId).maybeSingle(),
  ]);
  return h && b ? { hook: h as HookgenHookRow, beat: b as HookgenBeatRow } : null;
}

/**
 * The marketer's own image prompt for a beat, used as written from now on
 * (a later fix in words is added to it). An image already drawn from the old
 * prompt is drawn again, which takes back its approval and clip.
 */
export async function setStillPrompt(db: SupabaseClient, hookId: string, beatId: string, prompt: string): Promise<string | null> {
  const found = await beatAndHook(db, hookId, beatId);
  if (!found) return "Not found";
  const text = prompt.trim().slice(0, 4000);
  if (!text) return "Write the image prompt first";
  if (found.hook.status === "planning") return "Still planning";
  const redraw = found.beat.still_status !== null;
  await db
    .from("hookgen_beats")
    .update({ scene: text, fix: "", still_custom: true, still_prompt: text, ...(redraw ? { approved: false, ...stepReset("still"), ...stepReset("clip"), ...checkReset, rerolls: 0 } : {}) })
    .eq("id", beatId);
  if (redraw) await db.from("hookgen_hooks").update({ status: "stills", final_status: null, final_error: null, error: null }).eq("id", hookId);
  return null;
}

/** The marketer's own clip prompt, used as written. A clip already made is made again (and the hook joined again). */
export async function setMotionPrompt(db: SupabaseClient, hookId: string, beatId: string, prompt: string): Promise<string | null> {
  const found = await beatAndHook(db, hookId, beatId);
  if (!found) return "Not found";
  const text = prompt.trim().slice(0, 4000);
  if (!text) return "Write the clip prompt first";
  const redo = found.beat.clip_status !== null;
  await db
    .from("hookgen_beats")
    .update({ motion: text, motion_custom: true, motion_prompt: text, ...(redo ? { ...stepReset("clip"), ...checkReset, rerolls: 0 } : {}) })
    .eq("id", beatId);
  if (redo) {
    await db.from("hookgen_hooks").update({ final_status: null, final_error: null }).eq("id", hookId);
    await startWhenAllApproved(db, hookId);
  }
  return null;
}

/**
 * How long a beat's clip is: a length the hook's video model accepts, kept
 * whole in the hook, or null to fit the line again (cut where it ends). A clip
 * already made at another length is made again.
 */
export async function setClipSeconds(db: SupabaseClient, hookId: string, beatId: string, seconds: unknown): Promise<string | null> {
  const found = await beatAndHook(db, hookId, beatId);
  if (!found) return "Not found";
  const { hook, beat } = found;
  const chosen = validClipSeconds(hook.video_model, seconds);
  if (seconds !== null && chosen === null) return "That length is not one this video model makes";
  const next = chosen ?? clipSecondsFor(hook.video_model, Number(beat.seconds));
  if (next === beat.clip_seconds && (chosen !== null) === beat.clip_seconds_set) return null;
  const redo = beat.clip_status !== null && next !== beat.clip_seconds;
  await db
    .from("hookgen_beats")
    .update({ clip_seconds: next, clip_seconds_set: chosen !== null, ...(redo ? { ...stepReset("clip"), ...checkReset, rerolls: 0 } : {}) })
    .eq("id", beatId);
  // Even without a new clip, the join cuts differently.
  if (beat.clip_status !== null) await db.from("hookgen_hooks").update({ final_status: null, final_error: null }).eq("id", hookId).in("status", ["working", "done"]);
  await startWhenAllApproved(db, hookId);
  return null;
}

/** A held hook: the marketer has read the prompts; draw the starting images now. */
export async function drawStills(db: SupabaseClient, hookId: string): Promise<string | null> {
  const { error } = await db.from("hookgen_hooks").update({ hold_stills: false }).eq("id", hookId);
  return error ? error.message : null;
}

/**
 * Drop a beat the marketer does not want, before it is animated. The others
 * move up, and the hook animates by itself when every remaining image is
 * approved. Its words go with it; edit another beat's line to keep them.
 */
export async function removeBeat(db: SupabaseClient, hookId: string, beatId: string): Promise<string | null> {
  const { data } = await db.from("hookgen_beats").select("id, idx, kind, clip_status").eq("hook_id", hookId).order("idx");
  const beats = (data ?? []) as Array<Pick<HookgenBeatRow, "id" | "idx" | "kind" | "clip_status">>;
  const beat = beats.find((b) => b.id === beatId);
  if (!beat) return "Not found";
  if (beats.length === 1) return "A hook needs at least one beat";
  if (beat.clip_status) return "This beat is already animated; it stays in the hook";
  await db.from("hook_studio_jobs").update({ status: "canceled" }).like("kind", "hookgen_%").eq("status", "queued").eq("params->>beat_id", beatId);
  const { error } = await db.from("hookgen_beats").delete().eq("id", beatId);
  if (error) return error.message;
  const { data: files } = await db.storage.from(BOARD_BUCKET).list(`hook-generator/${hookId}`, { limit: 1000 });
  const paths = (files ?? []).filter((f) => f.name.includes(beatId)).map((f) => `hook-generator/${hookId}/${f.name}`);
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  // Close the gap in order (unique per hook), lowest first so no two beats share a place.
  const rest = beats.filter((b) => b.id !== beatId);
  for (const [i, b] of rest.entries()) if (b.idx !== i) await db.from("hookgen_beats").update({ idx: i }).eq("id", b.id);
  await db.from("hookgen_hooks").update({ beat_kinds: rest.map((b) => b.kind), final_status: null, final_error: null }).eq("id", hookId);
  await startWhenAllApproved(db, hookId);
  return null;
}

/** Animate an approved beat again (the same image); the hook is joined again afterwards. */
export async function redoClip(db: SupabaseClient, hookId: string, beatId: string): Promise<string | null> {
  const { data } = await db.from("hookgen_beats").select("approved, still_status").eq("id", beatId).eq("hook_id", hookId).maybeSingle();
  if (!data) return "Not found";
  if (!data.approved || data.still_status !== "done") return "Approve the image first";
  await db.from("hookgen_beats").update({ ...stepReset("clip"), ...checkReset, rerolls: 0 }).eq("id", beatId);
  await db.from("hookgen_hooks").update({ final_status: null, final_error: null, error: null }).eq("id", hookId).neq("status", "planning");
  await startWhenAllApproved(db, hookId);
  return null;
}

/** Join the current clips again. */
export async function rejoin(db: SupabaseClient, hookId: string): Promise<string | null> {
  const { error } = await db.from("hookgen_hooks").update({ status: "working", final_status: null, final_error: null, error: null }).eq("id", hookId).in("status", ["working", "done"]);
  return error ? error.message : null;
}

/** Remove a hook, its beats and files; queued jobs are canceled. Uploaded references stay (other takes may use them). */
export async function deleteHook(db: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await db.from("hookgen_hooks").select("id").eq("id", id).maybeSingle();
  if (!data) return "Not found";
  await db.from("hook_studio_jobs").update({ status: "canceled" }).like("kind", "hookgen_%").eq("status", "queued").eq("params->>hook_id", id);
  const { data: files } = await db.storage.from(BOARD_BUCKET).list(`hook-generator/${id}`, { limit: 1000 });
  const paths = (files ?? []).map((f) => `hook-generator/${id}/${f.name}`);
  if (paths.length) await db.storage.from(BOARD_BUCKET).remove(paths);
  const { error } = await db.from("hookgen_hooks").delete().eq("id", id);
  return error ? error.message : null;
}
