# Hook Studio worker

Renders Hook Studio jobs on this Mac with the Higgsfield CLI, using the
creator-plan credits of the signed-in CLI account. The dashboard on Vercel
only queues jobs; this script does the work.

## Needs
- `higgsfield` CLI signed in (`higgsfield auth login`), on `~/.local/bin`.
- `ffmpeg` and `ffprobe` on `~/.local/bin`.
- `worker/.env` (gitignored) with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  Optional: `CONCURRENCY` (default 2), `POLL_MS` (default 3000).

## Run
```
scripts/hook-worker-install.sh          # start at login, restart on crash
scripts/hook-worker-install.sh status
scripts/hook-worker-install.sh logs
scripts/hook-worker-install.sh stop
```
By hand: `node worker/hook-worker.mjs`.

## What a job does
1. Claims the oldest queued row in `hook_studio_jobs` (atomic, skip-locked).
2. Remake: downloads the reference from the `hook-studio` bucket, trims it to the
   hook's window (max 15 s), drops audio, and runs the engine with `--video`
   (and `--image` for a pinned face). Face: runs Soul 2 with the preset prompt.
3. Records the CLI's credit estimate and the redacted command on the row.
4. Downloads the result from the Higgsfield CDN (URLs expire) and uploads it to
   `results/<hook_id>/<job_id>.<ext>` in the bucket.
5. Marks the row `done`, or `failed` with the CLI's last lines as the error.

Heartbeats `app_settings.hook_worker_status` each loop with the balance. The
page shows "Mac worker online" when the heartbeat is under two minutes old.
Jobs left `running` for over 45 minutes (a crash) are re-queued by the claim
function.
