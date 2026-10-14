# Hook Studio worker

Renders Hook Studio jobs on this Mac with the Higgsfield CLI, using the
creator-plan credits of the signed-in CLI account. The dashboard on Vercel
only queues jobs; this script does the work.

## Needs
- `higgsfield` CLI signed in (`higgsfield auth login`), on `~/.local/bin`.
- `ffmpeg` and `ffprobe` on `~/.local/bin`.
- `yt-dlp` on `~/.local/bin` for Marketing Board references (TikTok, Ads
  Library, Facebook, Instagram, YouTube). Standalone binary, no Python needed:
  `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o ~/.local/bin/yt-dlp && chmod a+rx ~/.local/bin/yt-dlp`.
  Update it the same way when a site stops working (`yt-dlp -U` also works).
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

Marketing Board (`kind = board_fetch`): yt-dlp downloads the best MP4 up to
1080p, ffmpeg takes a thumbnail, both go to `items/<item_id>/<job_id>.*` in
the `marketing-board` bucket, and the card gets its title, creator, size and
duration. Failures land on the card as `video_error`, with a Try again button.

Remake Studio (`kind = remake_*`):
- `remake_split`: ffmpeg scene detection on the reference, 1.5–12 s shots (max
  12), one JPEG frame per shot to `remake/<project>/frames/`, rows in
  `remake_shots`, project → `classifying` (Claude labels them on the next load).
- `remake_still`: Nano Banana Pro with the frame, the cast image (if locked) and
  up to 4 brand product photos → `remake/<project>/stills/`.
- `remake_tts`: `text2speech_v2` (elevenlabs) speaks the shot's script →
  `remake/<project>/audio/`, duration probed.
- `remake_clip`: Genjutsu (trimmed real shot as motion reference), Kling, Wan 2.7
  or Seedance 2.0 lipsync (still + audio) → `remake/<project>/clips/`.

Heartbeats `app_settings.hook_worker_status` each loop with the balance,
the yt-dlp version (`ytdlp`, null when it is not installed) and the CLI's
text-to-speech voices (`voices`, refreshed every ten minutes). The
page shows "Mac worker online" when the heartbeat is under two minutes old.
Jobs left `running` for over 45 minutes (a crash) are re-queued by the claim
function.
