/**
 * What the board needs from a video file before it is uploaded: its length,
 * its size, and a poster frame for the card. Read in the browser from the
 * local file, so an uploaded reference is ready at once without the Mac
 * worker. A file the browser cannot decode (an HEVC .mov in Chrome, say)
 * still uploads; it just comes back with no poster or size.
 */
export interface VideoProbe {
  thumb: Blob | null;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const BY_EXTENSION: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/** The file's video type, from the browser or, when it gives none, from the extension. */
export function videoMimeOf(file: File): string | null {
  if (VIDEO_TYPES.includes(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

const POSTER_MAX_SIDE = 960;
const TIMEOUT_MS = 15_000;

function waitFor(v: HTMLVideoElement, event: "loadedmetadata" | "seeked", start?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener(event, onOk);
      v.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onErr = () => finish(false);
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    v.addEventListener(event, onOk);
    v.addEventListener("error", onErr);
    start?.();
  });
}

export async function probeVideoFile(file: File): Promise<VideoProbe> {
  const empty: VideoProbe = { thumb: null, duration: null, width: null, height: null };
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  try {
    if (!(await waitFor(v, "loadedmetadata", () => (v.src = url)))) return empty;
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const width = v.videoWidth || null;
    const height = v.videoHeight || null;
    if (!width || !height) return { ...empty, duration };

    // A frame a little way in: the first one is often black or a fade.
    const at = duration ? Math.min(1, duration * 0.25) : 0;
    if (!(await waitFor(v, "seeked", () => (v.currentTime = at)))) return { thumb: null, duration, width, height };
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(width, height));
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return { thumb: null, duration, width, height };
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const thumb = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
    return { thumb, duration, width, height };
  } catch {
    return empty;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}
