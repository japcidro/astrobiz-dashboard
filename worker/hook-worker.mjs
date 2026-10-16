#!/usr/bin/env node
/**
 * Hook Studio worker — runs on Julius's Mac.
 *
 * Polls the hook_studio_jobs queue in Supabase, renders each job with the
 * Higgsfield CLI (creator-plan credits), copies the output into the
 * hook-studio storage bucket, and marks the job done. Heartbeats the CLI's
 * credit balance into app_settings so the page can show "Mac worker online".
 *
 * No npm dependencies: Node 20+ fetch, child_process, fs. Config comes from
 * worker/.env (gitignored). Install as a launchd agent with
 * scripts/hook-worker-install.sh, or run by hand:  node worker/hook-worker.mjs
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "1.7.4";
const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Config ───
await loadEnv(join(HERE, ".env"));
const SUPABASE_URL = need("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const HF = process.env.HIGGSFIELD_BIN || join(homedir(), ".local/bin/higgsfield");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
// Marketing Board: saves a high-quality copy of TikTok / Ads Library /
// Facebook / Instagram / YouTube references. Standalone binary on ~/.local/bin.
const YTDLP = process.env.YTDLP_BIN || join(homedir(), ".local/bin/yt-dlp");
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS || 3000));
const WORK_DIR = process.env.WORK_DIR || join(homedir(), "Library/Application Support/astrobiz-hook-worker");
const BUCKET = "hook-studio";
const BOARD_BUCKET = "marketing-board";
const STATUS_KEY = "hook_worker_status";
const WORKER_NAME = `${hostname()}:${process.pid}`;
const MAX_REFERENCE_SECONDS = 15;
const CLI_TIMEOUT_MS = 35 * 60 * 1000;

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[worker] missing ${name} in worker/.env`);
    process.exit(2);
  }
  return v;
}

async function loadEnv(file) {
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env: rely on the environment
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ─── Supabase REST helpers (service role) ───
const authHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { ...authHeaders, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const claimJob = () =>
  rest("/rpc/hook_studio_claim_job", { method: "POST", body: { p_worker: WORKER_NAME } }).then((rows) =>
    Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  );

const updateJob = (id, patch) =>
  rest(`/hook_studio_jobs?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

const updateStudioResult = (id, patch) =>
  rest(`/image_studio_results?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

const updateTalkingHead = (id, patch) =>
  rest(`/talking_heads?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

const getHook = (id) => rest(`/hook_studio_hooks?id=eq.${id}&select=*`).then((rows) => rows?.[0] ?? null);

async function heartbeat(extra = {}) {
  const value = JSON.stringify({
    last_seen: new Date().toISOString(),
    worker: WORKER_NAME,
    version: VERSION,
    ...extra,
  });
  await rest("/app_settings?on_conflict=key", {
    method: "POST",
    body: { key: STATUS_KEY, value },
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
}

async function storageDownload(path, dest, bucket = BUCKET) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { headers: authHeaders });
  if (!res.ok || !res.body) throw new Error(`storage download ${path} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function storageUpload(path, file, contentType, bucket = BUCKET) {
  const data = await readFile(file);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": contentType, "x-upsert": "true" },
    body: data,
  });
  if (!res.ok) throw new Error(`storage upload ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function downloadUrl(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status} from Higgsfield CDN`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// ─── Processes ───
function run(cmd, args, { timeoutMs = CLI_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" }, cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
  });
}

async function probeDuration(file) {
  const r = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeoutMs: 60_000 });
  const n = parseFloat(r.out.trim());
  return Number.isFinite(n) ? n : null;
}

/** Trim to the hook's window, drop audio, cap at 15 s, re-encode for a clean upload. */
async function trimReference(src, dest, start, end) {
  const duration = await probeDuration(src);
  const s = Math.max(0, Number(start) || 0);
  let e = end === null || end === undefined ? (duration ?? s + MAX_REFERENCE_SECONDS) : Number(end);
  if (!(e > s)) e = s + MAX_REFERENCE_SECONDS;
  if (e - s > MAX_REFERENCE_SECONDS) e = s + MAX_REFERENCE_SECONDS;
  if (duration && e > duration) e = duration;
  const args = [
    "-y", "-loglevel", "error",
    "-i", src,
    "-ss", String(s), "-to", String(e),
    "-an",
    "-vf", "scale='min(1080,iw)':-2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    dest,
  ];
  const r = await run(FFMPEG, args, { timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg trim failed: ${r.err.slice(-300)}`);
  return Math.round((e - s) * 10) / 10;
}

// ─── Engines → CLI arguments (mirror of src/lib/hook-studio/engines.ts) ───
function clampInt(n, lo, hi) {
  const v = Math.round(Number(n) || lo);
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Video from a UGC image. `motion` engines also take the reference clip;
 * `arcads` engines animate the image from the prompt alone.
 */
/** The CLI reads a leading "@" as a file reference; a prompt must not start with one. */
const safePrompt = (t) => String(t ?? "").replace(/^\s*@+/, "").trim() || "natural candid motion";

function remakeArgs(params, ugcFile, refFile, seconds) {
  const p = safePrompt(params.prompt);
  const hi = params.quality === "high";
  const d = String(clampInt(params.duration ?? seconds ?? 5, 3, 15));
  switch (params.engine) {
    case "genjutsu": {
      if (!refFile) throw new Error("Genjutsu needs a reference clip");
      return ["hf_mult_motion_control", "--resolution", hi ? "1080p" : "720p", "--prompt", p, "--video", refFile, "--image", ugcFile];
    }
    case "seedance_ref": {
      if (!refFile) throw new Error("Seedance references need a reference clip");
      return ["seedance_2_0", "--prompt", p, "--image", ugcFile, "--video", refFile, "--aspect_ratio", "9:16", "--resolution", hi ? "1080p" : "720p", "--generate_audio", "false", "--duration", String(clampInt(params.duration ?? seconds ?? 5, 4, 15))];
    }
    case "kling_i2v":
      return ["kling3_0", "--mode", hi ? "pro" : "std", "--aspect_ratio", "9:16", "--sound", "off", "--duration", d, "--start-image", ugcFile, "--prompt", p];
    case "kling_turbo":
      return ["kling3_0_turbo", "--aspect_ratio", "9:16", "--resolution", "720p", "--duration", d, "--start-image", ugcFile, "--prompt", p];
    case "seedance_i2v":
      return ["seedance_2_0", "--prompt", p, "--start-image", ugcFile, "--aspect_ratio", "9:16", "--resolution", hi ? "1080p" : "720p", "--generate_audio", "false", "--duration", String(clampInt(params.duration ?? seconds ?? 5, 4, 15))];
    // Kept for rows made before 2026-09-28 v2; the page no longer offers them.
    case "kling_edit": {
      const a = ["kling_video_edit", "--mode", hi ? "pro" : "std", "--prompt", p, "--video", refFile];
      if (ugcFile) a.push("--image", ugcFile);
      return a;
    }
    default:
      throw new Error(`Unknown engine ${params.engine}`);
  }
}

function faceArgs(params) {
  return ["text2image_soul_v2", "--prompt", params.prompt, "--aspect_ratio", "9:16", "--quality", "1.5k"];
}

/** UGC Generator: person swap on a still, or text-only without one. 9:16, Nano Banana Pro. */
function ugcArgs(params, srcFile) {
  const a = ["nano_banana_pro", "--aspect_ratio", "9:16"];
  if (srcFile) a.push("--image", srcFile);
  return [...a, "--prompt", safePrompt(params.prompt)];
}

/** Hide local paths in the stored command line. */
const redactCommand = (args) => ["higgsfield", "generate", "create", ...args.map((a) => (a.startsWith("/") ? "<file>" : a))].join(" ");

async function estimateCredits(args) {
  const r = await run(HF, ["generate", "cost", ...args], { timeoutMs: 5 * 60_000 });
  const m = r.out.match(/([\d.]+)\s*credits?/i);
  return m ? Number(m[1]) : null;
}

/** The job id a non-waiting `generate create` printed: an object (or list / jobs[]) with an id, else the first UUID in the text. */
function findJobId(text) {
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.id === "string") return item.id;
      if (Array.isArray(item.jobs) && typeof item.jobs[0]?.id === "string") return item.jobs[0].id;
      if (item.job && typeof item.job.id === "string") return item.job.id;
    }
  } catch {
    // not JSON
  }
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

function findResultUrl(text) {
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (item && typeof item === "object") {
        const url = item.result_url || item.resultUrl || item.url;
        if (typeof url === "string" && url.startsWith("http")) return { url, id: item.id ?? null, status: item.status ?? null };
        if (item.jobs && Array.isArray(item.jobs)) {
          const inner = findResultUrl(JSON.stringify(item.jobs));
          if (inner) return inner;
        }
      }
    }
  } catch {
    // not JSON; fall through to the regex
  }
  const m = text.match(/https?:\/\/\S+\.(?:mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a)(?:\?\S*)?/i);
  return m ? { url: m[0], id: null, status: null } : null;
}

function extensionOf(url) {
  const m = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "bin";
}
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };

// ─── Clipper (tables keep the remake_* names) ───
const updateShot = (id, patch) =>
  rest(`/remake_shots?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });
const updateProject = (id, patch) =>
  rest(`/remake_projects?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

const MIN_SHOT = 1.0;
const MAX_SHOT = 12;
const MAX_SHOTS = 16;
const SCENE_THRESHOLD = 0.2;

/** Cut points from ffmpeg's scene detector, then tidy into clips the engines can take. */
async function detectShots(src, duration) {
  const r = await run(FFMPEG, ["-hide_banner", "-i", src, "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-an", "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  const cuts = [...r.err.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1])).filter((t) => Number.isFinite(t) && t > 0.5 && t < duration - 0.5);
  const bounds = [0, ...Array.from(new Set(cuts)).sort((a, b) => a - b), duration];
  let segs = [];
  let start = 0;
  for (let i = 1; i < bounds.length; i++) {
    const end = bounds[i];
    const last = i === bounds.length - 1;
    if (end - start < MIN_SHOT && !last) continue;
    if (end - start < MIN_SHOT && segs.length) segs[segs.length - 1][1] = end;
    else segs.push([start, end]);
    start = end;
  }
  // A static ad with no cuts still gets a few clips to work on.
  if (segs.length <= 1 && duration > 6) {
    segs = [];
    for (let t = 0; t < duration; t += 4) segs.push([t, Math.min(duration, t + 4)]);
    if (segs.length > 1 && segs[segs.length - 1][1] - segs[segs.length - 1][0] < MIN_SHOT) {
      segs[segs.length - 2][1] = duration;
      segs.pop();
    }
  }
  // Too many: merge the shortest into its neighbour until it fits.
  while (segs.length > MAX_SHOTS) {
    let k = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i][1] - segs[i][0] < segs[k][1] - segs[k][0]) k = i;
    const j = k === 0 ? 1 : k - 1;
    const lo = Math.min(k, j);
    segs[lo] = [segs[lo][0], segs[lo + 1][1]];
    segs.splice(lo + 1, 1);
  }
  // Too long for the engines: split evenly.
  const out = [];
  for (const [s, e] of segs) {
    const n = Math.ceil((e - s) / MAX_SHOT);
    for (let i = 0; i < n; i++) out.push([s + ((e - s) * i) / n, s + ((e - s) * (i + 1)) / n]);
  }
  return out.map(([s, e]) => [Math.round(s * 10) / 10, Math.round(e * 10) / 10]);
}

async function grabFrame(src, at, dest) {
  const r = await run(FFMPEG, ["-y", "-loglevel", "error", "-ss", String(at), "-i", src, "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-q:v", "2", dest], { timeoutMs: 2 * 60_000 });
  return r.code === 0;
}

/** The real clip, with its sound, re-encoded so it plays everywhere. */
async function cutClip(src, s, e, dest) {
  const r = await run(
    FFMPEG,
    ["-y", "-loglevel", "error", "-ss", String(s), "-to", String(e), "-i", src, "-vf", "scale='min(1080,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest],
    { timeoutMs: 10 * 60_000 }
  );
  if (r.code !== 0) throw new Error(`ffmpeg cut failed: ${r.err.slice(-300)}`);
}

const STRIP_FONT = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"].find((f) => existsSync(f));

/**
 * Up to 60 frames spread evenly over the whole reference, for the timeline and
 * Claude's re-detect: numbered (so Claude doesn't miscount) and tiled into one
 * JPEG in rows of up to 10, always full rows. Tile i covers
 * [i·span/n, (i+1)·span/n]; fps keeps the last frame before (i+0.5)·span/n,
 * so each tile shows the middle of its slot.
 */
async function makeStrip(src, duration, dest) {
  const cols = Math.max(1, Math.min(10, Math.ceil(duration)));
  const n = Math.min(60, Math.ceil(Math.ceil(duration) / cols) * cols);
  const span = Math.round(duration * 1000) / 1000;
  const label = `drawtext=${STRIP_FONT ? `fontfile=${STRIP_FONT}:` : ""}text='%{n}':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=3:x=4:y=4`;
  const r = await run(
    FFMPEG,
    ["-y", "-loglevel", "error", "-i", src, "-vf", `fps=${n}/${span},scale=120:-2,${label},tile=${cols}x${n / cols}`, "-frames:v", "1", "-q:v", "4", dest],
    { timeoutMs: 5 * 60_000 }
  );
  if (r.code !== 0) {
    log(`strip failed: ${r.err.slice(-300)}`);
    return null;
  }
  return { count: n, span, cols };
}

/** Frame + real clip for a list of shots; shared by the first cut and later timeline edits. */
async function materializeShots(dir, src, projectId, shots, keyOf) {
  const out = [];
  for (const s of shots) {
    const key = keyOf(s);
    const frameFile = join(dir, `frame-${key}.jpg`);
    const clipFile = join(dir, `ref-${key}.mp4`);
    let framePath = null;
    let refPath = null;
    if (await grabFrame(src, Math.min(s.end_s - 0.2, s.start_s + (s.end_s - s.start_s) / 2), frameFile)) {
      framePath = `remake/${projectId}/frames/${key}.jpg`;
      await storageUpload(framePath, frameFile, "image/jpeg", BOARD_BUCKET);
    }
    try {
      await cutClip(src, s.start_s, s.end_s, clipFile);
      refPath = `remake/${projectId}/ref/${key}.mp4`;
      await storageUpload(refPath, clipFile, "video/mp4", BOARD_BUCKET);
    } catch (e) {
      log(`ref clip ${key} failed: ${e.message}`);
    }
    out.push({ ...s, frame_path: framePath, ref_path: refPath });
  }
  return out;
}

async function remakeSplit(job, dir) {
  const { project_id: projectId, source_path: sourcePath } = job.params;
  const src = join(dir, "source.mp4");
  await storageDownload(sourcePath, src, BOARD_BUCKET);
  const duration = await probeDuration(src);
  if (!duration) throw new Error("Could not read the video's duration");

  const stripFile = join(dir, "strip.jpg");
  const strip = await makeStrip(src, duration, stripFile);
  let stripPath = null;
  if (strip) {
    stripPath = `remake/${projectId}/strip-${job.id}.jpg`;
    await storageUpload(stripPath, stripFile, "image/jpeg", BOARD_BUCKET);
  }

  const segs = (await detectShots(src, duration)).map(([s, e], idx) => ({ idx, start_s: s, end_s: e }));
  const rows = await materializeShots(dir, src, projectId, segs, (s) => `${s.idx}-${job.id}`);
  await rest(`/remake_shots?project_id=eq.${projectId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await rest("/remake_shots", {
    method: "POST",
    body: rows.map((r) => ({ project_id: projectId, idx: r.idx, start_s: r.start_s, end_s: r.end_s, frame_path: r.frame_path, ref_path: r.ref_path })),
    headers: { Prefer: "return=minimal" },
  });
  await updateProject(projectId, { status: "classifying", source_duration: Math.round(duration * 10) / 10, strip_path: stripPath, strip_count: strip?.count ?? null, strip_span: strip?.span ?? null, strip_cols: strip?.cols ?? null, error: null });
  return `${rows.length} clips`;
}

/** After a split, merge or re-detect: new frame and real clip for the shots that changed. */
async function remakeFrames(job, dir) {
  const { project_id: projectId, source_path: sourcePath, shots, relabel } = job.params;
  const src = join(dir, "source.mp4");
  await storageDownload(sourcePath, src, BOARD_BUCKET);
  const rows = await materializeShots(dir, src, projectId, shots, (s) => `${s.id}-${job.id}`);
  for (const r of rows) {
    const patch = { frame_path: r.frame_path, ref_path: r.ref_path };
    if (relabel) Object.assign(patch, { description: null });
    await updateShot(r.id, patch);
  }
  if (relabel) await updateProject(projectId, { status: "classifying" });
  return `${rows.length} clips refreshed`;
}

/**
 * Wait for a submitted Higgsfield job by asking for it every few seconds.
 * `generate wait` was seen hanging after a network drop long after the job
 * had finished; each `generate get` has its own short timeout instead.
 */
async function pollHiggsfieldJob(jobId, timeoutMs = 30 * 60_000) {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    const g = await run(HF, ["generate", "get", jobId, "--json"], { timeoutMs: 60_000 });
    try {
      const d = JSON.parse(g.out);
      const status = String(d.status ?? "");
      if (status === "completed") {
        const found = findResultUrl(g.out);
        if (found) return found;
        throw new Error(`Higgsfield job ${jobId} finished without a result`);
      }
      if (/fail|nsfw|cancel|error|reject/i.test(status)) throw new Error(`Higgsfield job ${jobId} ${status}${d.error ? `: ${String(d.error).slice(0, 300)}` : ""}`);
    } catch (e) {
      if (e instanceof SyntaxError) last = (g.err || g.out).trim().slice(-300);
      else throw e;
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`Higgsfield job ${jobId} still not done after ${Math.round(timeoutMs / 60_000)} min${last ? ` (${last})` : ""}`);
}

/** Run a CLI generation and bring the result file home. */
async function generateToFile(job, args, dir) {
  const estimate = await estimateCredits(args);
  await updateJob(job.id, { estimate_credits: estimate, cli_command: redactCommand(args) });
  // Submit without waiting, give the slot back while Higgsfield renders, then wait on the job id.
  // The account runs at most 8 renders at once; past that the CLI answers rate_limit_reached,
  // so wait (without holding a slot) and submit again.
  let c;
  for (let attempt = 0; ; attempt++) {
    c = await run(HF, ["generate", "create", ...args, "--json"], { timeoutMs: 10 * 60_000 });
    if (!/rate_limit_reached/.test(c.out + c.err) || attempt >= 90) break;
    releaseSlot();
    try {
      await new Promise((r) => setTimeout(r, 20_000));
    } finally {
      await acquireSlot();
    }
  }
  let found = c.code === 0 ? findResultUrl(c.out) : null;
  if (!found) {
    const jobId = c.code === 0 ? findJobId(c.out) : null;
    if (!jobId) {
      const tail = (c.err || c.out).trim().split("\n").slice(-6).join("\n").slice(-600);
      throw new Error(tail || `CLI exited ${c.code} with no job id`);
    }
    await updateJob(job.id, { cli_job_id: jobId });
    releaseSlot();
    try {
      found = await pollHiggsfieldJob(jobId);
    } finally {
      await acquireSlot();
    }
    found.id = found.id ?? jobId;
  }
  const ext = extensionOf(found.url);
  const outFile = join(dir, `result.${ext}`);
  await downloadUrl(found.url, outFile);
  const size = (await stat(outFile)).size;
  if (size < 1000) throw new Error("Result file is empty");
  return { outFile, ext, size, estimate, cliJobId: found.id, url: found.url };
}

async function remakeStill(job, dir) {
  const p = job.params;
  const frame = join(dir, `frame.${extensionOf(p.frame_path)}`);
  await storageDownload(p.frame_path, frame, BOARD_BUCKET);
  const images = [frame];
  if (p.cast_path) {
    const cast = join(dir, `cast.${extensionOf(p.cast_path)}`);
    await storageDownload(p.cast_path, cast, BOARD_BUCKET);
    images.push(cast);
  }
  for (const [i, path] of (p.product_paths ?? []).entries()) {
    const f = join(dir, `product-${i}.${extensionOf(path)}`);
    await storageDownload(path, f, BOARD_BUCKET);
    images.push(f);
  }
  const args = ["nano_banana_pro", "--aspect_ratio", "9:16", "--resolution", "2k", ...images.flatMap((f) => ["--image", f]), "--prompt", safePrompt(p.prompt)];
  await updateShot(p.shot_id, { still_status: "running" });
  const r = await generateToFile(job, args, dir);
  const stillPath = `remake/${p.project_id}/stills/${p.shot_id}-${job.id}.${r.ext}`;
  await storageUpload(stillPath, r.outFile, MIME[r.ext] || "image/png", BOARD_BUCKET);
  // A small JPEG for the brand check and thumbnails; the engines use the full still.
  const previewFile = join(dir, "preview.jpg");
  const pv = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", r.outFile, "-vf", "scale='min(900,iw)':-2", "-q:v", "3", previewFile], { timeoutMs: 60_000 });
  let previewPath = null;
  if (pv.code === 0) {
    previewPath = `remake/${p.project_id}/stills/${p.shot_id}-${job.id}-preview.jpg`;
    await storageUpload(previewPath, previewFile, "image/jpeg", BOARD_BUCKET);
  }
  await updateShot(p.shot_id, { still_path: stillPath, still_preview_path: previewPath, still_status: "done", still_error: null, brand_check: null });
  return r;
}

/** ElevenLabs v4 voiceover. `dialogue` is a JSON array passed through a file. */
async function remakeTts(job, dir) {
  const p = job.params;
  const dialogueFile = join(dir, "dialogue.json");
  await writeFile(dialogueFile, JSON.stringify([{ text: String(p.script).slice(0, 1500), voice_id: p.voice_id, voice_type: p.voice_type }]));
  const args = ["elevenlabs_v4", "--dialogue", `@${dialogueFile}`];
  await updateShot(p.shot_id, { audio_status: "running" });
  const r = await generateToFile(job, args, dir);
  const seconds = await probeDuration(r.outFile);
  const audioPath = `remake/${p.project_id}/audio/${p.shot_id}-${job.id}.${r.ext}`;
  await storageUpload(audioPath, r.outFile, MIME[r.ext] || "audio/mpeg", BOARD_BUCKET);
  await updateShot(p.shot_id, { audio_path: audioPath, audio_seconds: seconds ? Math.round(seconds * 10) / 10 : null, audio_status: "done", audio_error: null });
  return r;
}

/** Every engine starts from our still. Veo makes voice and lips itself; Genjutsu copies the real clip. */
/** Veo from a still: 3.1 (4/6/8 s, fast or preview) or 3 (8 s). */
function veoArgs(engine, p, hi, still) {
  if (engine === "veo3_1") return ["veo3_1", "--prompt", safePrompt(p.prompt), "--aspect_ratio", "9:16", "--duration", String([4, 6, 8].includes(Number(p.duration)) ? p.duration : 8), "--quality", hi ? "high" : "basic", "--variant", hi ? "veo-3-1-preview" : "veo-3-1-fast", "--start-image", still];
  return ["veo3", "--prompt", safePrompt(p.prompt), "--aspect_ratio", "9:16", "--variant", hi ? "veo-3-preview" : "veo-3-fast", "--start-image", still];
}

/** Image Studio: Nano Banana Pro from the prompt and the role-tagged attachments; a pair is one wide image split in two. */
async function imageGen(job, dir) {
  const p = job.params;
  const files = [];
  for (const [i, img] of (p.images ?? []).entries()) {
    const f = join(dir, `in-${i}.${extensionOf(img.path)}`);
    await storageDownload(img.path, f, img.bucket || BOARD_BUCKET);
    files.push(f);
  }
  const args = ["nano_banana_pro", "--aspect_ratio", p.aspect_ratio || "1:1", "--resolution", "2k", ...files.flatMap((f) => ["--image", f]), "--prompt", safePrompt(p.prompt)];
  await updateStudioResult(p.result_id, { status: "running" });
  const r = await generateToFile(job, args, dir);
  const base = `image-studio/${p.run_id}/${p.result_id}-${job.id}`;
  const mainPath = `${base}.${r.ext}`;
  await storageUpload(mainPath, r.outFile, MIME[r.ext] || "image/png", BOARD_BUCKET);
  const preview = join(dir, "preview.jpg");
  const pv = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", r.outFile, "-vf", "scale='min(1000,iw)':-2", "-q:v", "3", preview], { timeoutMs: 60_000 });
  let previewPath = null;
  if (pv.code === 0) {
    previewPath = `${base}-preview.jpg`;
    await storageUpload(previewPath, preview, "image/jpeg", BOARD_BUCKET);
  }
  let pairPaths = null;
  if (p.split) {
    const before = join(dir, "before.png");
    const after = join(dir, "after.png");
    const a = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", r.outFile, "-vf", "crop=floor(iw/2/2)*2:ih:0:0", before], { timeoutMs: 60_000 });
    const b = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", r.outFile, "-vf", "crop=floor(iw/2/2)*2:ih:floor(iw/2):0", after], { timeoutMs: 60_000 });
    if (a.code === 0 && b.code === 0) {
      pairPaths = [`${base}-before.png`, `${base}-after.png`];
      await storageUpload(pairPaths[0], before, "image/png", BOARD_BUCKET);
      await storageUpload(pairPaths[1], after, "image/png", BOARD_BUCKET);
    }
  }
  await updateStudioResult(p.result_id, { path: mainPath, preview_path: previewPath, pair_paths: pairPaths, status: "done", error: null, credits: r.estimate });
  return r;
}

/** Talking Head tool: a still from the library speaks the script with Veo. */
async function talkingHead(job, dir) {
  const p = job.params;
  const still = join(dir, `still.${extensionOf(p.still_path)}`);
  await storageDownload(p.still_path, still, BOARD_BUCKET);
  const args = veoArgs(p.engine === "veo3" ? "veo3" : "veo3_1", p, p.quality === "high", still);
  await updateTalkingHead(p.talking_head_id, { status: "running" });
  const r = await generateToFile(job, args, dir);
  const clipPath = `talking-heads/${p.talking_head_id}/${job.id}.mp4`;
  await storageUpload(clipPath, r.outFile, "video/mp4", BOARD_BUCKET);
  await updateTalkingHead(p.talking_head_id, { clip_path: clipPath, status: "done", error: null, credits: r.estimate });
  return r;
}

// ─── Cartoon Hooks ───
// The app plans a hook (Claude writes each beat's prompts) and resets steps for
// redos; this worker is the orchestrator. cartoonAdvance queues every step whose
// status is null and whose inputs are ready: character image → starting image
// per beat (Seedream 5.0 Flash, with the character as reference) → clip per beat
// (Seedance 2.0 Mini) and voiceover per beat (ElevenLabs) → the joined hook.
// Mirror of src/lib/cartoon/engines.ts.
const CARTOON_IMAGE = "seedream_5_0_flash";
const CARTOON_CLIP = "seedance_2_0_mini";
const cartoonClipSeconds = (s) => Math.min(15, Math.max(4, Math.ceil(Number(s) + 0.3)));
const CARTOON_W = 720;
const CARTOON_H = 1280;

const updateCartoonHook = (id, patch) =>
  rest(`/cartoon_hooks?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });
const updateCartoonBeat = (id, patch) =>
  rest(`/cartoon_beats?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

/** Move a step from null (not started) to queued, only if nobody else did; true when this call won. */
async function claimCartoonStep(table, id, step) {
  const rows = await rest(`/${table}?id=eq.${id}&${step}_status=is.null`, {
    method: "PATCH",
    body: { [`${step}_status`]: "queued", [`${step}_error`]: null },
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function queueCartoonStep(table, id, step, kind, engine, params) {
  if (!(await claimCartoonStep(table, id, step))) return;
  try {
    await rest("/hook_studio_jobs", { method: "POST", body: { kind, engine, status: "queued", params }, headers: { Prefer: "return=minimal" } });
  } catch (e) {
    await rest(`/${table}?id=eq.${id}`, { method: "PATCH", body: { [`${step}_status`]: null }, headers: { Prefer: "return=minimal" } }).catch(() => {});
    throw e;
  }
}

async function cartoonAdvance(hookId) {
  const hook = (await rest(`/cartoon_hooks?id=eq.${hookId}&select=*`))?.[0];
  if (!hook || hook.status !== "working") return;
  const beats = (await rest(`/cartoon_beats?hook_id=eq.${hookId}&select=*&order=idx`)) ?? [];
  if (beats.length === 0) return;

  if (hook.character_prompt && hook.character_status === null) {
    await queueCartoonStep("cartoon_hooks", hook.id, "character", "cartoon_character", CARTOON_IMAGE, { hook_id: hook.id, prompt: hook.character_prompt });
  }
  const characterReady = !hook.character_prompt || (hook.character_status === "done" && hook.character_path);
  for (const b of beats) {
    if (b.still_status === null && (!b.uses_character || characterReady)) {
      await queueCartoonStep("cartoon_beats", b.id, "still", "cartoon_still", CARTOON_IMAGE, {
        hook_id: hook.id,
        beat_id: b.id,
        prompt: b.still_prompt,
        character_path: b.uses_character && hook.character_prompt ? hook.character_path : null,
      });
    }
    if (b.still_status === "done" && b.still_path && b.clip_status === null) {
      await queueCartoonStep("cartoon_beats", b.id, "clip", "cartoon_clip", CARTOON_CLIP, {
        hook_id: hook.id,
        beat_id: b.id,
        prompt: b.motion_prompt,
        still_path: b.still_path,
        duration: cartoonClipSeconds(b.seconds),
        resolution: hook.resolution === "720p" ? "720p" : "480p",
      });
    }
    // The team's own ElevenLabs voices are made by the app on Vercel (the key lives there); only wait for those.
    if (hook.voice_on && hook.voice_provider !== "elevenlabs" && hook.voice_id && b.voice_status === null && b.line.trim()) {
      await queueCartoonStep("cartoon_beats", b.id, "voice", "cartoon_voice", "elevenlabs_v4", {
        hook_id: hook.id,
        beat_id: b.id,
        text: b.line,
        voice_id: hook.voice_id,
        voice_type: hook.voice_type,
      });
    }
  }
  const clipsDone = beats.every((b) => b.clip_status === "done" && b.clip_path);
  const voicesSettled = !hook.voice_on || beats.every((b) => !b.line.trim() || b.voice_status === "done" || b.voice_status === "failed");
  if (clipsDone && voicesSettled && hook.final_status === null) {
    await queueCartoonStep("cartoon_hooks", hook.id, "final", "cartoon_join", "ffmpeg", { hook_id: hook.id });
  }
}

/** Every hook still being made gets its next steps queued; runs from the main loop. */
let lastCartoonSweep = 0;
async function cartoonSweep() {
  if (Date.now() - lastCartoonSweep < 10_000) return;
  lastCartoonSweep = Date.now();
  const hooks = (await rest("/cartoon_hooks?status=eq.working&select=id&order=created_at&limit=50")) ?? [];
  for (const h of hooks) {
    await cartoonAdvance(h.id).catch((e) => log(`cartoon ${h.id} advance: ${e.message}`));
  }
}

/** A JPEG for thumbnails; the engines get the full image. */
async function cartoonPreview(src, dir, path) {
  const previewFile = join(dir, "preview.jpg");
  const pv = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", src, "-vf", "scale='min(720,iw)':-2", "-q:v", "3", previewFile], { timeoutMs: 60_000 });
  if (pv.code !== 0) return null;
  await storageUpload(path, previewFile, "image/jpeg", BOARD_BUCKET);
  return path;
}

async function cartoonCharacter(job, dir) {
  const p = job.params;
  const args = [CARTOON_IMAGE, "--aspect_ratio", "9:16", "--resolution", "2k", "--prompt", safePrompt(p.prompt)];
  await updateCartoonHook(p.hook_id, { character_status: "running" });
  const r = await generateToFile(job, args, dir);
  const base = `cartoon-hooks/${p.hook_id}/character-${job.id}`;
  await storageUpload(`${base}.${r.ext}`, r.outFile, MIME[r.ext] || "image/png", BOARD_BUCKET);
  const preview = await cartoonPreview(r.outFile, dir, `${base}-preview.jpg`);
  await updateCartoonHook(p.hook_id, { character_path: `${base}.${r.ext}`, character_preview_path: preview, character_status: "done", character_error: null, character_credits: r.estimate });
  return r;
}

async function cartoonStill(job, dir) {
  const p = job.params;
  const args = [CARTOON_IMAGE, "--aspect_ratio", "9:16", "--resolution", "2k"];
  if (p.character_path) {
    const ref = join(dir, `character.${extensionOf(p.character_path)}`);
    await storageDownload(p.character_path, ref, BOARD_BUCKET);
    args.push("--image", ref);
  }
  args.push("--prompt", safePrompt(p.prompt));
  await updateCartoonBeat(p.beat_id, { still_status: "running" });
  const r = await generateToFile(job, args, dir);
  const base = `cartoon-hooks/${p.hook_id}/still-${p.beat_id}-${job.id}`;
  await storageUpload(`${base}.${r.ext}`, r.outFile, MIME[r.ext] || "image/png", BOARD_BUCKET);
  const preview = await cartoonPreview(r.outFile, dir, `${base}-preview.jpg`);
  await updateCartoonBeat(p.beat_id, { still_path: `${base}.${r.ext}`, still_preview_path: preview, still_status: "done", still_error: null, still_credits: r.estimate });
  return r;
}

async function cartoonClip(job, dir) {
  const p = job.params;
  const still = join(dir, `still.${extensionOf(p.still_path)}`);
  await storageDownload(p.still_path, still, BOARD_BUCKET);
  const args = [CARTOON_CLIP, "--start-image", still, "--duration", String(clampInt(p.duration, 4, 15)), "--resolution", p.resolution === "720p" ? "720p" : "480p", "--generate_audio", "false", "--aspect_ratio", "9:16", "--prompt", safePrompt(p.prompt)];
  await updateCartoonBeat(p.beat_id, { clip_status: "running" });
  const r = await generateToFile(job, args, dir);
  const clipPath = `cartoon-hooks/${p.hook_id}/clip-${p.beat_id}-${job.id}.mp4`;
  await storageUpload(clipPath, r.outFile, "video/mp4", BOARD_BUCKET);
  await updateCartoonBeat(p.beat_id, { clip_path: clipPath, clip_status: "done", clip_error: null, clip_credits: r.estimate });
  return r;
}

async function cartoonVoice(job, dir) {
  const p = job.params;
  const dialogueFile = join(dir, "dialogue.json");
  await writeFile(dialogueFile, JSON.stringify([{ text: String(p.text).slice(0, 400), voice_id: p.voice_id, voice_type: p.voice_type }]));
  await updateCartoonBeat(p.beat_id, { voice_status: "running" });
  const r = await generateToFile(job, ["elevenlabs_v4", "--dialogue", `@${dialogueFile}`], dir);
  const seconds = await probeDuration(r.outFile);
  const voicePath = `cartoon-hooks/${p.hook_id}/voice-${p.beat_id}-${job.id}.${r.ext}`;
  await storageUpload(voicePath, r.outFile, MIME[r.ext] || "audio/mpeg", BOARD_BUCKET);
  await updateCartoonBeat(p.beat_id, { voice_path: voicePath, voice_seconds: seconds ? Math.round(seconds * 100) / 100 : null, voice_status: "done", voice_error: null, voice_credits: r.estimate });
  return r;
}

/**
 * The hook: each beat's clip cut to its length (the voiceover line's length when
 * there is one, else the planned length; a short clip holds its last frame),
 * scaled to 720x1280, joined in order, with the voiceover lines laid end to end.
 */
async function cartoonJoin(job, dir) {
  const hookId = job.params.hook_id;
  const hook = (await rest(`/cartoon_hooks?id=eq.${hookId}&select=*`))?.[0];
  if (!hook) throw new Error("Hook was deleted");
  const beats = (await rest(`/cartoon_beats?hook_id=eq.${hookId}&select=*&order=idx`)) ?? [];
  if (beats.length === 0 || beats.some((b) => !b.clip_path)) throw new Error("A beat has no clip yet");
  await updateCartoonHook(hookId, { final_status: "running" });

  const inputs = [];
  const filters = [];
  const withVoice = hook.voice_on && beats.some((b) => b.voice_path);
  let total = 0;
  for (const [i, b] of beats.entries()) {
    const clipFile = join(dir, `clip-${i}.mp4`);
    await storageDownload(b.clip_path, clipFile, BOARD_BUCKET);
    const vIn = inputs.push(clipFile) - 1;
    const len = Math.round(Math.max(1, b.voice_path && b.voice_seconds ? Number(b.voice_seconds) + 0.15 : Number(b.seconds)) * 100) / 100;
    total += len;
    filters.push(
      `[${vIn}:v]scale=${CARTOON_W}:${CARTOON_H}:force_original_aspect_ratio=increase,crop=${CARTOON_W}:${CARTOON_H},fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=15,trim=0:${len},setpts=PTS-STARTPTS[v${i}]`
    );
    if (!withVoice) continue;
    if (b.voice_path) {
      const voiceFile = join(dir, `voice-${i}.${extensionOf(b.voice_path)}`);
      await storageDownload(b.voice_path, voiceFile, BOARD_BUCKET);
      const aIn = inputs.push(voiceFile) - 1;
      filters.push(`[${aIn}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${len},asetpts=PTS-STARTPTS[a${i}]`);
    } else {
      filters.push(`aevalsrc=0:c=stereo:s=44100:d=${len}[a${i}]`);
    }
  }
  const order = beats.map((_, i) => (withVoice ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  filters.push(`${order}concat=n=${beats.length}:v=1:a=${withVoice ? 1 : 0}${withVoice ? "[v][a]" : "[v]"}`);
  const out = join(dir, "hook.mp4");
  const args = ["-y", "-loglevel", "error", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", filters.join(";"), "-map", "[v]"];
  if (withVoice) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "160k");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  await updateJob(job.id, { cli_command: `ffmpeg join of ${beats.length} beats` });
  const r = await run(FFMPEG, args, { timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg join failed: ${r.err.slice(-400)}`);
  const finalPath = `cartoon-hooks/${hookId}/final-${job.id}.mp4`;
  await storageUpload(finalPath, out, "video/mp4", BOARD_BUCKET);
  await updateCartoonHook(hookId, { final_path: finalPath, final_status: "done", final_error: null, final_seconds: Math.round(total * 10) / 10, status: "done" });
  return `${beats.length} beats, ${total.toFixed(1)} s`;
}

const CARTOON_RUN = { cartoon_character: cartoonCharacter, cartoon_still: cartoonStill, cartoon_clip: cartoonClip, cartoon_voice: cartoonVoice, cartoon_join: cartoonJoin };

async function remakeClip(job, dir) {
  const p = job.params;
  const still = join(dir, `still.${extensionOf(p.still_path)}`);
  await storageDownload(p.still_path, still, BOARD_BUCKET);
  const hi = p.quality === "high";
  let args;
  switch (p.engine) {
    case "veo3_1":
    case "veo3":
      args = veoArgs(p.engine, p, hi, still);
      break;
    case "genjutsu": {
      const ref = join(dir, "reference.mp4");
      await storageDownload(p.ref_path, ref, BOARD_BUCKET);
      const refDur = await probeDuration(ref);
      if (refDur && refDur > MAX_REFERENCE_SECONDS) {
        const trimmed = join(dir, "reference-trim.mp4");
        await trimReference(ref, trimmed, 0, MAX_REFERENCE_SECONDS);
        args = ["hf_mult_motion_control", "--resolution", hi ? "1080p" : "720p", "--prompt", safePrompt(p.prompt), "--video", trimmed, "--image", still];
      } else {
        args = ["hf_mult_motion_control", "--resolution", hi ? "1080p" : "720p", "--prompt", safePrompt(p.prompt), "--video", ref, "--image", still];
      }
      break;
    }
    case "kling_i2v":
      args = remakeArgs({ engine: "kling_i2v", prompt: p.prompt, quality: p.quality, duration: Number(p.duration) || 5 }, still, null, Number(p.duration) || 5);
      break;
    default:
      throw new Error(`Unknown clip engine ${p.engine}`);
  }
  await updateShot(p.shot_id, { clip_status: "running" });
  const r = await generateToFile(job, args, dir);
  const clipPath = `remake/${p.project_id}/clips/${p.shot_id}-${job.id}.mp4`;
  await storageUpload(clipPath, r.outFile, "video/mp4", BOARD_BUCKET);
  await updateShot(p.shot_id, { clip_path: clipPath, clip_status: "done", clip_error: null, clip_credits: r.estimate });
  return r;
}

/** Voiceover onto a clip: the clip keeps its length, the voice is laid on top (original sound ducked). */
async function remakeMix(job, dir) {
  const p = job.params;
  const clip = join(dir, "clip.mp4");
  const audio = join(dir, `vo.${extensionOf(p.audio_path)}`);
  await storageDownload(p.clip_path, clip, BOARD_BUCKET);
  await storageDownload(p.audio_path, audio, BOARD_BUCKET);
  const out = join(dir, "mixed.mp4");
  await updateShot(p.shot_id, { mixed_status: "running" });
  const hasAudio = (await run(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", clip], { timeoutMs: 60_000 })).out.trim().length > 0;
  const filter = hasAudio
    ? "[0:a]volume=0.15[bg];[1:a]apad[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=0[a]"
    : "[1:a]apad[a]";
  const r = await run(FFMPEG, ["-y", "-loglevel", "error", "-i", clip, "-i", audio, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out], { timeoutMs: 5 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg mix failed: ${r.err.slice(-300)}`);
  const mixedPath = `remake/${p.project_id}/mixed/${p.shot_id}-${job.id}.mp4`;
  await storageUpload(mixedPath, out, "video/mp4", BOARD_BUCKET);
  await updateShot(p.shot_id, { mixed_path: mixedPath, mixed_status: "done", mixed_key: p.key });
  return "mixed";
}

const REMAKE_FAIL = {
  remake_still: (p, m) => updateShot(p.shot_id, { still_status: "failed", still_error: m }),
  remake_tts: (p, m) => updateShot(p.shot_id, { audio_status: "failed", audio_error: m }),
  remake_clip: (p, m) => updateShot(p.shot_id, { clip_status: "failed", clip_error: m }),
  remake_mix: (p, m) => updateShot(p.shot_id, { mixed_status: "failed" }).then(() => log(`mix: ${m}`)),
  remake_split: (p, m) => updateProject(p.project_id, { status: "failed", error: m }),
  remake_frames: (p, m) => updateProject(p.project_id, { status: "failed", error: m }),
  talking_head: (p, m) => updateTalkingHead(p.talking_head_id, { status: "failed", error: m }),
  image_gen: (p, m) => updateStudioResult(p.result_id, { status: "failed", error: m }),
  cartoon_character: (p, m) => updateCartoonHook(p.hook_id, { character_status: "failed", character_error: m }),
  cartoon_still: (p, m) => updateCartoonBeat(p.beat_id, { still_status: "failed", still_error: m }),
  cartoon_clip: (p, m) => updateCartoonBeat(p.beat_id, { clip_status: "failed", clip_error: m }),
  cartoon_voice: (p, m) => updateCartoonBeat(p.beat_id, { voice_status: "failed", voice_error: m }),
  cartoon_join: (p, m) => updateCartoonHook(p.hook_id, { final_status: "failed", final_error: m }),
};

async function processRemakeJob(job) {
  const dir = join(WORK_DIR, "jobs", job.id);
  await mkdir(dir, { recursive: true });
  log(`job ${job.id} ${job.kind} start`);
  try {
    const r =
      job.kind === "remake_split" ? await remakeSplit(job, dir)
      : job.kind === "remake_frames" ? await remakeFrames(job, dir)
      : job.kind === "remake_still" ? await remakeStill(job, dir)
      : job.kind === "remake_tts" ? await remakeTts(job, dir)
      : job.kind === "remake_mix" ? await remakeMix(job, dir)
      : job.kind === "talking_head" ? await talkingHead(job, dir)
      : job.kind === "image_gen" ? await imageGen(job, dir)
      : CARTOON_RUN[job.kind] ? await CARTOON_RUN[job.kind](job, dir)
      : await remakeClip(job, dir);
    const patch = { status: "done", error: null, finished_at: new Date().toISOString() };
    if (r && typeof r === "object") Object.assign(patch, { cli_job_id: r.cliJobId ?? null, result_source_url: r.url ?? null });
    await updateJob(job.id, patch);
    log(`job ${job.id} done${r && r.estimate !== undefined ? ` (${r.estimate ?? "?"} cr)` : typeof r === "string" ? ` (${r})` : ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = /HTTP 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|upload_url/i.test(message);
    if (transient && job.attempts < 2) {
      log(`job ${job.id} transient error, re-queued: ${message.slice(0, 160)}`);
      await updateJob(job.id, { status: "queued", worker: null, claimed_at: null, started_at: null, error: `retrying after: ${message.slice(0, 300)}` }).catch(() => {});
      return;
    }
    log(`job ${job.id} FAILED: ${message}`);
    await updateJob(job.id, { status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString() }).catch(() => {});
    await REMAKE_FAIL[job.kind]?.(job.params ?? {}, message.slice(0, 500)).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    // A finished cartoon step usually unlocks the next one; queue it now rather than at the next sweep.
    if (job.kind.startsWith("cartoon_") && job.params?.hook_id) await cartoonAdvance(job.params.hook_id).catch(() => {});
  }
}

// ─── Marketing Board ───
const updateBoardItem = (id, patch) =>
  rest(`/marketing_board_items?id=eq.${id}`, { method: "PATCH", body: patch, headers: { Prefer: "return=minimal" } });

async function probeVideo(file) {
  const r = await run(
    FFPROBE,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
    { timeoutMs: 60_000 }
  );
  try {
    const j = JSON.parse(r.out);
    const s = j.streams?.[0] ?? {};
    const d = parseFloat(j.format?.duration);
    return {
      width: Number.isInteger(s.width) ? s.width : null,
      height: Number.isInteger(s.height) ? s.height : null,
      duration: Number.isFinite(d) ? Math.round(d * 10) / 10 : null,
    };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

/** A still from just after the start, for the card. */
async function makeThumbnail(src, dest) {
  const r = await run(FFMPEG, ["-y", "-loglevel", "error", "-ss", "0.3", "-i", src, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "3", dest], { timeoutMs: 2 * 60_000 });
  return r.code === 0;
}

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/**
 * yt-dlp fetches the best MP4 up to 1080p (merging video+audio when the
 * site splits them), and writes the page's metadata next to it. Ads
 * Library ads with several videos are playlists: the first one is taken.
 */
/**
 * Facebook blocks a plain fetch of Ads Library / post pages (403), but
 * yt-dlp gets through. It saves the pages it fetched (--write-pages), and an
 * Ads Library page carries the creative as original_image_url (resized_image_url
 * as a fallback), while posts carry og:image. Returns the first image URL found.
 */
async function imageUrlViaYtDlp(url, dir) {
  const pagesDir = join(dir, "pages");
  await mkdir(pagesDir, { recursive: true });
  await run(YTDLP, ["--no-warnings", "--ignore-no-formats-error", "--write-pages", "-q", "--skip-download", url], { timeoutMs: 3 * 60_000, cwd: pagesDir });
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(pagesDir)).filter((f) => f.endsWith(".dump"));
  const unescape = (s) => {
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      return s.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    }
  };
  // An Ads Library page lists many of the advertiser's ads; only the block
  // for the requested ad id (ad_archive_id) may supply the image.
  const wantedId = (() => {
    try {
      return new URL(url).searchParams.get("id");
    } catch {
      return null;
    }
  })();
  const KEYS = ["original_image_url", "resized_image_url", "video_preview_image_url"];
  const firstIn = (text) => {
    for (const key of KEYS) {
      const m = text.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
      if (m && m[1]) return unescape(m[1]);
    }
    return null;
  };
  for (const f of files) {
    const html = await readFile(join(pagesDir, f), "utf8");
    if (wantedId) {
      const marker = new RegExp(`"ad_archive_id":"?${wantedId}"?`, "g");
      let hit;
      while ((hit = marker.exec(html))) {
        const rest = html.slice(hit.index + hit[0].length);
        const next = rest.search(/"ad_archive_id":/);
        const found = firstIn(next === -1 ? rest : rest.slice(0, next));
        if (found) return found;
      }
      // The page has the ad but no image in its block: do not fall back to someone else's ad.
      if (marker.test(html)) continue;
    }
    const any = firstIn(html);
    if (any) return any;
    const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
    if (og && og[1]) return og[1].replace(/&amp;/g, "&");
  }
  return null;
}

/** The image behind a link: the file itself, or the page's og:image / twitter:image. */
async function fetchImageFromLink(url, dir) {
  const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "text/html,image/*,*/*;q=0.8" };
  const get = async (u) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      return await fetch(u, { headers, redirect: "follow", signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  const save = async (res) => {
    const header = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\//.test(header) && !/^(application\/octet-stream|binary\/octet-stream)$/.test(header)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null;
    // Trust the bytes, not the header or the file name: Facebook's CDN hands out PNGs as .jpg.
    const type = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : null;
    if (!ext) return null;
    const file = join(dir, `image.${ext}`);
    await writeFile(file, buf);
    return { file, ext, mime: type };
  };
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const facebookish = /(^|\.)(facebook\.com|fb\.com|fb\.watch|instagram\.com)$/.test(host);
  let res = facebookish ? null : await get(url);
  if (res && !res.ok && res.status !== 403) throw new Error(`The link answered ${res.status}`);
  if (res && res.ok) {
    const direct = await save(res);
    if (direct) return direct;
  }
  if (facebookish || !res || res.status === 403) {
    // Facebook / Instagram: let yt-dlp fetch the page, then take the creative's own URL.
    const found = await imageUrlViaYtDlp(url, dir);
    if (!found) throw new Error("No image found behind this link; upload the image instead");
    const img = await get(found);
    if (!img.ok) throw new Error(`The ad image answered ${img.status}`);
    const saved = await save(img);
    if (!saved) throw new Error("The ad image could not be read; upload it instead");
    return saved;
  }
  const html = await res.text();
  const meta = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i) || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!meta) throw new Error("No image found behind this link; upload the image instead");
  const imgUrl = meta[1].replace(/&amp;/g, "&");
  res = await get(imgUrl);
  if (!res.ok) throw new Error(`The page's image answered ${res.status}`);
  const fromMeta = await save(res);
  if (!fromMeta) throw new Error("The page's image could not be read; upload it instead");
  return fromMeta;
}

async function boardFetchImage(job, itemId, url) {
  const dir = join(WORK_DIR, "jobs", job.id);
  await mkdir(dir, { recursive: true });
  try {
    await updateBoardItem(itemId, { video_status: "saving", video_error: null });
    const img = await fetchImageFromLink(url, dir);
    const probe = await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", img.file], { timeoutMs: 30_000 });
    const [w, h] = probe.code === 0 ? probe.out.trim().split(",").map(Number) : [null, null];
    const imagePath = `board/images/${itemId}-${job.id}.${img.ext}`;
    await storageUpload(imagePath, img.file, img.mime, BOARD_BUCKET);
    await updateBoardItem(itemId, { image_path: imagePath, thumb_path: imagePath, video_status: "ready", video_error: null, width: w || null, height: h || null });
    const { size } = await stat(img.file);
    return { size };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function boardFetch(job) {
  const { item_id: itemId, url } = job.params;
  if (!itemId || !url) throw new Error("board_fetch needs item_id and url");
  if (job.params.kind === "image") return boardFetchImage(job, itemId, url);
  const dir = join(WORK_DIR, "jobs", job.id);
  await mkdir(dir, { recursive: true });
  try {
    await stat(YTDLP);
  } catch {
    throw new Error(`yt-dlp is not installed on the Mac worker (expected at ${YTDLP}). See worker/README.md.`);
  }
  await updateBoardItem(itemId, { video_status: "saving", video_error: null });

  const args = [
    "--no-warnings", "--no-progress", "--no-mtime", "--playlist-items", "1",
    "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b",
    "--merge-output-format", "mp4",
    // ffmpeg is on the launchd PATH; point yt-dlp at it only when overridden.
    ...(FFMPEG.startsWith("/") ? ["--ffmpeg-location", dirname(FFMPEG)] : []),
    "--write-info-json", "-o", join(dir, "video.%(ext)s"),
    url,
  ];
  await updateJob(job.id, { cli_command: ["yt-dlp", ...args.map((a) => (a.startsWith("/") ? "<file>" : a))].join(" ") });
  const r = await run(YTDLP, args, { timeoutMs: 15 * 60_000 });
  if (r.code !== 0) {
    const tail = (r.err || r.out).trim().split("\n").filter((l) => /ERROR|error/i.test(l)).slice(-3).join(" ").slice(-500);
    throw new Error(tail || `yt-dlp exited ${r.code}`);
  }

  const videoFile = join(dir, "video.mp4");
  const size = (await stat(videoFile).catch(() => null))?.size ?? 0;
  if (size < 1000) throw new Error("yt-dlp produced no video file (private, removed, or login-only page)");

  let info = {};
  try {
    info = JSON.parse(await readFile(join(dir, "video.info.json"), "utf8"));
  } catch {
    // metadata is a bonus
  }
  const meta = await probeVideo(videoFile);
  const thumbFile = join(dir, "thumb.jpg");
  const hasThumb = await makeThumbnail(videoFile, thumbFile);

  const videoPath = `items/${itemId}/${job.id}.mp4`;
  const thumbPath = `items/${itemId}/${job.id}.jpg`;
  await storageUpload(videoPath, videoFile, "video/mp4", BOARD_BUCKET);
  if (hasThumb) await storageUpload(thumbPath, thumbFile, "image/jpeg", BOARD_BUCKET);

  // Keep a title the owner typed; otherwise take the page's.
  const current = await rest(`/marketing_board_items?id=eq.${itemId}&select=title,author`).then((rows) => rows?.[0] ?? null);
  if (!current) throw new Error("Card was deleted while saving");
  const patch = {
    video_path: videoPath,
    thumb_path: hasThumb ? thumbPath : null,
    video_status: "ready",
    video_error: null,
    ...meta,
  };
  const pageTitle = clip(info.title, 160) || clip(info.description, 160);
  if (!current.title || /^Ads Library ad/.test(current.title)) patch.title = pageTitle || current.title;
  if (!current.author) patch.author = clip(info.uploader, 120) || clip(info.channel, 120) || clip(info.creator, 120);
  await updateBoardItem(itemId, patch);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return { size, videoPath };
}

// ─── One job ───
async function processJob(job) {
  if (job.kind.startsWith("remake_") || job.kind.startsWith("cartoon_") || job.kind === "talking_head" || job.kind === "image_gen") return processRemakeJob(job);
  if (job.kind === "board_fetch") {
    log(`job ${job.id} board_fetch start`);
    try {
      const { size } = await boardFetch(job);
      await updateJob(job.id, { status: "done", error: null, finished_at: new Date().toISOString() });
      log(`job ${job.id} done (${(size / 1e6).toFixed(1)} MB)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`job ${job.id} FAILED: ${message}`);
      await updateJob(job.id, { status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString() }).catch(() => {});
      await updateBoardItem(job.params?.item_id, { video_status: "failed", video_error: message.slice(0, 500) }).catch(() => {});
      await rm(join(WORK_DIR, "jobs", job.id), { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  const dir = join(WORK_DIR, "jobs", job.id);
  await mkdir(dir, { recursive: true });
  log(`job ${job.id} ${job.kind}/${job.engine} start`);
  try {
    let args;
    let seconds = null;
    let faceFile = null;

    if (job.kind === "remake") {
      const p = job.params;
      const ugcFile = join(dir, `ugc.${extensionOf(p.ugc_path || p.face_path || "x.png")}`);
      await storageDownload(p.ugc_path || p.face_path, ugcFile);
      let refFile = null;
      if (p.reference_path) {
        const refSrc = join(dir, "reference-src.mp4");
        refFile = join(dir, "reference.mp4");
        await storageDownload(p.reference_path, refSrc);
        seconds = await trimReference(refSrc, refFile, p.trim_start, p.trim_end);
      }
      args = remakeArgs(p, ugcFile, refFile, seconds);
    } else if (job.kind === "ugc_image") {
      const p = job.params;
      let srcFile = null;
      if (p.source_path) {
        srcFile = join(dir, `source.${extensionOf(p.source_path)}`);
        await storageDownload(p.source_path, srcFile);
      }
      args = ugcArgs(p, srcFile);
    } else if (job.kind === "face") {
      args = faceArgs(job.params);
    } else {
      throw new Error(`Unknown job kind ${job.kind}`);
    }

    const estimate = await estimateCredits(args);
    await updateJob(job.id, { estimate_credits: estimate, cli_command: redactCommand(args) });

    const r = await run(HF, ["generate", "create", ...args, "--wait", "--wait-timeout", "30m", "--wait-interval", "5s", "--json"]);
    const found = findResultUrl(r.out) || findResultUrl(r.err);
    if (r.code !== 0 || !found) {
      const tail = (r.err || r.out).trim().split("\n").slice(-6).join("\n").slice(-600);
      throw new Error(tail || `CLI exited ${r.code} with no result`);
    }

    const ext = extensionOf(found.url);
    const outFile = join(dir, `result.${ext}`);
    await downloadUrl(found.url, outFile);
    const size = (await stat(outFile)).size;
    if (size < 1000) throw new Error("Result file is empty");

    const resultPath =
      job.kind === "face" ? `results/faces/${job.id}.${ext}`
      : job.kind === "ugc_image" ? `results/ugc/${job.id}.${ext}`
      : `results/${job.hook_id}/${job.id}.${ext}`;
    await storageUpload(resultPath, outFile, MIME[ext] || "application/octet-stream");

    await updateJob(job.id, {
      status: "done",
      cli_job_id: found.id,
      result_path: resultPath,
      result_source_url: found.url,
      error: null,
      finished_at: new Date().toISOString(),
    });
    log(`job ${job.id} done (${estimate ?? "?"} cr, ${(size / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Higgsfield's upload/CDN side flakes now and then (HTTP 5xx, "fetch
    // failed"). One automatic retry; a second failure is real.
    const transient = /HTTP 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|upload_url/i.test(message);
    if (transient && job.attempts < 2) {
      log(`job ${job.id} transient error, re-queued: ${message.slice(0, 160)}`);
      await updateJob(job.id, { status: "queued", worker: null, claimed_at: null, started_at: null, error: `retrying after: ${message.slice(0, 300)}` }).catch((e) =>
        log("could not re-queue:", e.message)
      );
      return;
    }
    log(`job ${job.id} FAILED: ${message}`);
    await updateJob(job.id, { status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString() }).catch((e) =>
      log("could not mark failed:", e.message)
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Balance + loop ───
let lastBalanceAt = 0;
let balance = {};
async function refreshBalance() {
  if (Date.now() - lastBalanceAt < 60_000) return;
  lastBalanceAt = Date.now();
  const r = await run(HF, ["account", "status", "--json"], { timeoutMs: 60_000 });
  try {
    const j = JSON.parse(r.out);
    balance = { credits: Number(j.credits), plan: j.subscription_plan_type ?? null, cli_ok: true };
  } catch {
    balance = { ...balance, cli_ok: false, cli_error: (r.err || r.out).trim().slice(-200) };
  }
  // Tell the Marketing Board whether references can be saved at all.
  const y = await run(YTDLP, ["--version"], { timeoutMs: 30_000 });
  balance.ytdlp = y.code === 0 ? y.out.trim().slice(0, 40) : null;
  // Remake Studio picks text-to-speech voices from this list; refresh it every ten minutes.
  if (Date.now() - lastVoicesAt > 10 * 60_000) {
    lastVoicesAt = Date.now();
    const v = await run(HF, ["voices", "list", "--json"], { timeoutMs: 60_000 });
    try {
      const items = JSON.parse(v.out).items ?? [];
      voices = items
        .filter((x) => x.status === "completed" && (x.voice_type === "preset" || x.voice_type === "element"))
        // The team's own voices first, so the 80 cap only ever trims presets.
        .sort((a, b) => (a.voice_type === "element" ? 0 : 1) - (b.voice_type === "element" ? 0 : 1))
        .slice(0, 80)
        .map((x) => ({ id: x.id, name: x.name, type: x.voice_type }));
    } catch {
      // keep the last list
    }
  }
  balance.voices = voices;
}
let lastVoicesAt = 0;
let voices = [];

/**
 * Slots: CONCURRENCY jobs may work on this Mac at once (downloads, ffmpeg,
 * uploads). While Higgsfield renders a job remotely, that job hands its slot
 * back (releaseSlot) and takes one again when the result is ready
 * (acquireSlot), so ten renders can be in flight while two jobs do local work.
 */
let active = 0;
let inflight = 0;
let stopping = false;
const slotWaiters = [];

function releaseSlot() {
  active = Math.max(0, active - 1);
  const next = slotWaiters.shift();
  if (next) next();
}

function acquireSlot() {
  return new Promise((resolve) => {
    const attempt = () => {
      if (active < CONCURRENCY) {
        active++;
        resolve();
      } else slotWaiters.push(attempt);
    };
    attempt();
  });
}

async function tick() {
  await refreshBalance();
  await heartbeat({ ...balance, active, inflight });
  await cartoonSweep().catch((e) => log("cartoon sweep:", e.message));
  while (active < CONCURRENCY && !stopping) {
    const job = await claimJob();
    if (!job) break;
    active++;
    inflight++;
    processJob(job).finally(() => {
      inflight--;
      releaseSlot();
    });
  }
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(join(WORK_DIR, "worker.pid"), String(process.pid));
  log(`hook worker ${VERSION} as ${WORKER_NAME}, concurrency ${CONCURRENCY}`);
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log("loop error:", err instanceof Error ? err.message : err);
    }
    if (stopping && inflight === 0) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log("stopped");
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) process.exit(0);
    stopping = true;
    log(`${sig}: finishing ${active} running job(s), no new claims`);
  });
}

main();
