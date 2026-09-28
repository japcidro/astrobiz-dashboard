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
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "1.1.0";
const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Config ───
await loadEnv(join(HERE, ".env"));
const SUPABASE_URL = need("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const HF = process.env.HIGGSFIELD_BIN || join(homedir(), ".local/bin/higgsfield");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS || 3000));
const WORK_DIR = process.env.WORK_DIR || join(homedir(), "Library/Application Support/astrobiz-hook-worker");
const BUCKET = "hook-studio";
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

async function storageDownload(path, dest) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: authHeaders });
  if (!res.ok || !res.body) throw new Error(`storage download ${path} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function storageUpload(path, file, contentType) {
  const data = await readFile(file);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
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
function run(cmd, args, { timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
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

/** UGC Generator: person swap on a still, 9:16, Nano Banana Pro. */
function ugcArgs(params, srcFile) {
  return ["nano_banana_pro", "--aspect_ratio", "9:16", "--image", srcFile, "--prompt", safePrompt(params.prompt)];
}

/** Hide local paths in the stored command line. */
const redactCommand = (args) => ["higgsfield", "generate", "create", ...args.map((a) => (a.startsWith("/") ? "<file>" : a))].join(" ");

async function estimateCredits(args) {
  const r = await run(HF, ["generate", "cost", ...args], { timeoutMs: 5 * 60_000 });
  const m = r.out.match(/([\d.]+)\s*credits?/i);
  return m ? Number(m[1]) : null;
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
  const m = text.match(/https?:\/\/\S+\.(?:mp4|mov|webm|png|jpe?g|webp)(?:\?\S*)?/i);
  return m ? { url: m[0], id: null, status: null } : null;
}

function extensionOf(url) {
  const m = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "bin";
}
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// ─── One job ───
async function processJob(job) {
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
      const srcFile = join(dir, `source.${extensionOf(p.source_path)}`);
      await storageDownload(p.source_path, srcFile);
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
}

let active = 0;
let stopping = false;

async function tick() {
  await refreshBalance();
  await heartbeat({ ...balance, active });
  while (active < CONCURRENCY && !stopping) {
    const job = await claimJob();
    if (!job) break;
    active++;
    processJob(job).finally(() => {
      active--;
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
    if (stopping && active === 0) break;
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
