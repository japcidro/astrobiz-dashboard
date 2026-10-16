/**
 * Storage takes at most 50 MB per file: the Supabase project's upload limit,
 * which sits below the marketing-board bucket's own 500 MB setting. A video
 * over it is re-encoded in the browser (WebCodecs via Mediabunny, loaded
 * only when needed) to land safely under, so a big CapCut export or spy-tool
 * download still uploads. The bitrate follows the length, so a short ad
 * keeps near-original quality; only a very long one is refused.
 */
export const STORAGE_MAX_BYTES = 50 * 1024 * 1024;
/** Aim below the cap: encoders overshoot a little and the MP4 adds overhead. */
const TARGET_BYTES = 45 * 1024 * 1024;
const AUDIO_BPS = 128_000;
const MAX_VIDEO_BPS = 8_000_000;
/** Below this the picture falls apart; ask for a trim instead. */
const MIN_VIDEO_BPS = 500_000;
/** Phone-vertical 1080p: the long side never needs more for a board copy. */
const MAX_LONG_SIDE = 1920;

export const fmtMB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export async function shrinkVideo(file: File, onProgress?: (fraction: number) => void): Promise<File> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    if (!duration || !Number.isFinite(duration)) throw new Error("Could not read this video's length to shrink it");
    const videoBps = Math.min(MAX_VIDEO_BPS, Math.floor((TARGET_BYTES * 8) / duration - AUDIO_BPS));
    if (videoBps < MIN_VIDEO_BPS) throw new Error(`This video is ${Math.round(duration)} s long, too long to fit 50 MB. Trim it, then upload again.`);

    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track found in this file");
    const w = track.displayWidth;
    const h = track.displayHeight;
    const scale = Math.max(w, h) > MAX_LONG_SIDE ? MAX_LONG_SIDE / Math.max(w, h) : 1;
    // Even sizes: H.264 encoders reject odd ones.
    const size = scale < 1 ? { width: Math.round((w * scale) / 2) * 2, height: Math.round((h * scale) / 2) * 2 } : {};

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { codec: "avc", bitrate: videoBps, forceTranscode: true, ...size },
      audio: { bitrate: AUDIO_BPS },
      showWarnings: false,
    });
    // Never hand back a silent copy without saying so.
    const lost = conversion.discardedTracks.filter((d) => d.reason !== "discarded_by_user");
    if (!conversion.isValid || lost.length > 0) {
      const what = lost.some((d) => d.track.type === "audio") ? "its sound" : "it";
      throw new Error(`This browser can't shrink ${what} (${lost.map((d) => d.reason).join(", ") || "unsupported"}). Export it under 50 MB, or try Chrome.`);
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(1, p)));
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Shrinking produced no file");
    const out = new File([buffer], `${file.name.replace(/\.[a-z0-9]+$/i, "")}.mp4`, { type: "video/mp4" });
    if (out.size > STORAGE_MAX_BYTES) throw new Error(`Still ${fmtMB(out.size)} after shrinking. Export a shorter or smaller file.`);
    return out;
  } finally {
    input.dispose?.();
  }
}
