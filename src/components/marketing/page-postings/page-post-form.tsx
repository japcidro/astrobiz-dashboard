"use client";

import { useState } from "react";
import {
  Loader2,
  Send,
  ImagePlus,
  X,
  CalendarClock,
  FileVideo,
} from "lucide-react";
import { toast } from "sonner";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Facebook scheduling window: at least 10 minutes, at most ~6 months ahead.
const MIN_SCHEDULE_SECONDS = 10 * 60;
const MAX_SCHEDULE_SECONDS = 60 * 60 * 24 * 30 * 6;

/** Extract a readable error from a Facebook Graph API JSON error body. */
function fbErrorMessage(json: unknown, fallback: string): string {
  const err = (json as { error?: Record<string, string> } | null)?.error;
  return err?.error_user_msg || err?.message || fallback;
}

/**
 * Upload a multipart body straight to Facebook with progress reporting.
 * We use XMLHttpRequest (not fetch) because it exposes upload progress, which
 * matters for large videos. Bytes go browser -> Facebook directly, so there is
 * no serverless request-body limit and effectively no file-size cap on our end.
 */
function uploadToFacebook(
  url: string,
  body: FormData,
  onProgress: (pct: number) => void
): Promise<{ ok: boolean; json: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = null;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, json });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(body);
  });
}

interface PagePostFormProps {
  pageId: string;
  pageName: string;
  /** Called after a post is successfully scheduled (e.g. to switch tabs). */
  onScheduled?: () => void;
}

export function PagePostForm({ pageId, pageName, onScheduled }: PagePostFormProps) {
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const isVideo = !!mediaFile && mediaFile.type.startsWith("video/");
  const canPost =
    !!pageId && (!!message.trim() || !!link.trim() || !!mediaFile) && !posting;

  // Default the schedule picker to ~15 minutes from now (local time), formatted
  // for a datetime-local input (YYYY-MM-DDTHH:mm).
  function defaultScheduleValue(): string {
    const d = new Date(Date.now() + 15 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  function toggleSchedule(on: boolean) {
    setScheduleEnabled(on);
    if (on && !scheduleAt) setScheduleAt(defaultScheduleValue());
  }

  /** Validate the schedule field and return the FB unix timestamp, or null. */
  function resolveScheduleTimestamp(): { ok: boolean; ts?: number } {
    if (!scheduleEnabled) return { ok: true };
    if (!scheduleAt) {
      toast.error("Pumili ng petsa at oras para sa schedule.");
      return { ok: false };
    }
    const ts = Math.floor(new Date(scheduleAt).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts)) {
      toast.error("Hindi wasto ang petsa/oras.");
      return { ok: false };
    }
    if (ts < now + MIN_SCHEDULE_SECONDS) {
      toast.error("Ang schedule ay dapat hindi bababa sa 10 minuto mula ngayon.");
      return { ok: false };
    }
    if (ts > now + MAX_SCHEDULE_SECONDS) {
      toast.error("Ang schedule ay dapat nasa loob ng 6 na buwan.");
      return { ok: false };
    }
    return { ok: true, ts };
  }

  async function handlePost() {
    if (!pageId) {
      toast.error("Pumili muna ng Facebook Page.");
      return;
    }
    if (!message.trim() && !link.trim() && !mediaFile) {
      toast.error("Maglagay ng message, link, larawan, o video.");
      return;
    }
    const schedule = resolveScheduleTimestamp();
    if (!schedule.ok) return;

    // Facebook organic posts can't have CTA buttons (Send Message / Shop Now —
    // those are ads-only). To make the link actually visible we fold the URL
    // into the post body: on a text post it renders a link preview card, and on
    // a photo/video post it stays as clickable text.
    const trimmed = message.trim();
    const linkTrim = link.trim();
    const composed =
      linkTrim && !trimmed.includes(linkTrim)
        ? trimmed
          ? `${trimmed}\n\n${linkTrim}`
          : linkTrim
        : trimmed;

    setPosting(true);
    setUploadPct(null);
    try {
      // Get a page access token from our server, then publish directly to
      // Facebook from the browser (avoids the serverless request-body limit
      // and imposes no file-size cap on media uploads).
      const tokenRes = await fetch(
        `/api/facebook/page-post?pageId=${encodeURIComponent(pageId)}`
      );
      const tokenJson = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenJson?.token) {
        toast.error(tokenJson?.error || "Hindi makuha ang page token.");
        return;
      }
      const token: string = tokenJson.token;

      let ok: boolean;
      let json: unknown;

      if (mediaFile) {
        // Photo -> /photos (caption); Video -> /videos (description).
        const endpoint = isVideo ? "videos" : "photos";
        const fbForm = new FormData();
        fbForm.append("access_token", token);
        fbForm.append("source", mediaFile);
        if (composed) fbForm.append(isVideo ? "description" : "caption", composed);
        if (schedule.ts) {
          fbForm.append("published", "false");
          fbForm.append("scheduled_publish_time", String(schedule.ts));
        }
        setUploadPct(0);
        const result = await uploadToFacebook(
          `${FB_API_BASE}/${pageId}/${endpoint}`,
          fbForm,
          setUploadPct
        );
        ok = result.ok;
        json = result.json;
      } else {
        // Text (+ optional link) post to the page feed. The URL lives inside
        // `message`, so Facebook auto-generates the link preview.
        const params = new URLSearchParams({ access_token: token, message: composed });
        if (schedule.ts) {
          params.append("published", "false");
          params.append("scheduled_publish_time", String(schedule.ts));
        }
        const res = await fetch(`${FB_API_BASE}/${pageId}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        ok = res.ok;
        json = await res.json().catch(() => null);
      }

      if (!ok) {
        toast.error(fbErrorMessage(json, "Hindi na-post. Subukan ulit."));
        return;
      }

      if (schedule.ts) {
        const when = new Date(schedule.ts * 1000).toLocaleString();
        toast.success(`Naka-schedule na sa ${pageName || "Page"} para sa ${when}.`);
        onScheduled?.();
      } else {
        // photos returns { id, post_id }; feed returns { id }; videos returns { id }
        const j = json as { post_id?: string; id?: string } | null;
        const postId = j?.post_id || j?.id || "";
        const permalink = postId ? `https://www.facebook.com/${postId}` : null;
        toast.success(
          permalink ? (
            <span>
              Na-post na sa {pageName || "Page"}!{" "}
              <a
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Tingnan ang post
              </a>
            </span>
          ) : (
            `Na-post na sa ${pageName || "Page"}!`
          )
        );
      }

      // Clear form (keep the selected page)
      setMessage("");
      setLink("");
      setMediaFile(null);
      setScheduleEnabled(false);
      setScheduleAt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hindi na-post. Subukan ulit.");
    } finally {
      setPosting(false);
      setUploadPct(null);
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Ano ang gusto mong i-post?"
          className="w-full rounded-lg border border-gray-700 bg-black/30 p-3 text-sm text-white placeholder-gray-500 focus:border-white focus:outline-none resize-y"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Link <span className="text-gray-600">(optional)</span>
        </label>
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-lg border border-gray-700 bg-black/30 p-3 text-sm text-white placeholder-gray-500 focus:border-white focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Isasama ang link sa loob ng post (may preview card sa text post,
          clickable link sa larawan/video). Ang CTA buttons tulad ng
          &ldquo;Send Message&rdquo; o &ldquo;Shop Now&rdquo; ay para lang sa
          mga boosted/ad post — hindi available sa organic posts.
        </p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1.5">
          Larawan o Video <span className="text-gray-600">(optional)</span>
        </label>
        {mediaFile ? (
          <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-black/30 p-3">
            <span className="flex items-center gap-2 text-sm text-gray-300 truncate">
              {isVideo ? (
                <FileVideo size={16} className="shrink-0 text-gray-400" />
              ) : (
                <ImagePlus size={16} className="shrink-0 text-gray-400" />
              )}
              <span className="truncate">{mediaFile.name}</span>
              <span className="shrink-0 text-gray-500">
                ({(mediaFile.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
            </span>
            <button
              type="button"
              onClick={() => setMediaFile(null)}
              disabled={posting}
              className="text-gray-400 hover:text-white cursor-pointer disabled:opacity-40"
              aria-label="Remove media"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 rounded-lg border border-dashed border-gray-700 p-3 text-sm text-gray-400 hover:border-gray-600 cursor-pointer">
            <ImagePlus size={16} />
            Pumili ng larawan o video
            <input
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-black/20 p-4">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => toggleSchedule(e.target.checked)}
            className="h-4 w-4 accent-white cursor-pointer"
          />
          <span className="flex items-center gap-2 text-sm text-gray-300">
            <CalendarClock size={16} className="text-gray-400" />
            I-schedule ang post
          </span>
        </label>

        {scheduleEnabled && (
          <div className="mt-3">
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-black/30 p-3 text-sm text-white focus:border-white focus:outline-none [color-scheme:dark]"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Kailangan hindi bababa sa 10 minuto mula ngayon, at nasa loob ng 6
              na buwan.
            </p>
          </div>
        )}
      </div>

      {uploadPct !== null && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Nag-a-upload...</span>
            <span>{uploadPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full bg-white transition-all"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handlePost}
        disabled={!canPost}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {posting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {uploadPct !== null && uploadPct < 100
              ? `Nag-a-upload... ${uploadPct}%`
              : scheduleEnabled
              ? "Nag-sa-schedule..."
              : "Nagpo-post..."}
          </>
        ) : scheduleEnabled ? (
          <>
            <CalendarClock size={16} />
            I-schedule
          </>
        ) : (
          <>
            <Send size={16} />
            I-post
          </>
        )}
      </button>
    </div>
  );
}
