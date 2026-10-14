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

Clipper (`kind = remake_*`, tables kept the remake_ names):
- `remake_split`: ffmpeg scene detection (threshold 0.2) on the reference, 1–12 s
  clips (max 16); per clip a JPEG frame AND the real clip cut out with sound
  (`remake/<project>/frames/`, `remake/<project>/ref/`); a one-frame-per-second
  strip (`strip-<job>.jpg`) for the timeline and Claude's re-detect; project →
  `classifying` (Claude labels clips on the next page load).
- `remake_frames`: after split / merge / re-detect, new frame + real clip for the
  clips that changed.
- `remake_still`: Nano Banana Pro with the frame, the cast image (if locked) and
  up to 4 brand product photos → `remake/<project>/stills/`.
- `remake_tts`: ElevenLabs v4 (`--dialogue @file.json`) voiceover →
  `remake/<project>/audio/`, duration probed.
- `remake_clip`: Veo 3.1 / Veo 3 (`--start-image` = our still; Veo speaks the
  script itself), Genjutsu (the real clip as motion reference), Kling →
  `remake/<project>/clips/`.
- `remake_mix`: voiceover laid over the clip (original audio ducked to 15%,
  clip length kept) → `remake/<project>/mixed/`. Queued by the app when a
  voiceover and its clip both exist.

Heartbeats `app_settings.hook_worker_status` each loop with the balance,
the yt-dlp version (`ytdlp`, null when it is not installed) and the CLI's
text-to-speech voices (`voices`, refreshed every ten minutes). The
page shows "Mac worker online" when the heartbeat is under two minutes old.
Jobs left `running` for over 45 minutes (a crash) are re-queued by the claim
function.
