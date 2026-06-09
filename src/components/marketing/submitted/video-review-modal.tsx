"use client";

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  ExternalLink,
  CheckCircle,
  Circle,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import type {
  SubmittedAd,
  SubmittedVideoSource,
} from "@/lib/marketing/submitted-videos";

interface Props {
  ad: SubmittedAd;
  role: "admin" | "marketing";
  onClose: () => void;
  onReviewedChange: (
    id: string,
    reviewedAt: string | null,
    reviewedByName: string | null
  ) => void;
}

function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VideoReviewModal({ ad, role, onClose, onReviewedChange }: Props) {
  const isVideo = ad.creative_type === "video";
  const [media, setMedia] = useState<SubmittedVideoSource | null>(null);
  const [loading, setLoading] = useState(isVideo);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | null>(ad.reviewed_at);
  const [reviewedByName, setReviewedByName] = useState<string | null>(
    ad.reviewed_by_name
  );

  // Videos: resolve a fresh playable URL from FB by video_id. Images display
  // directly from the creative's inline image_url (no call needed).
  useEffect(() => {
    if (!isVideo) return;
    if (!ad.video_id) {
      setError("No video id on this ad");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/marketing/submitted-videos/source?video_id=${ad.video_id}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(json.error || "Failed to load video");
        else setMedia(json.data as SubmittedVideoSource);
      } catch {
        if (!cancelled) setError("Failed to load video");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ad.video_id, isVideo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleReviewed = async () => {
    const next = !reviewedAt;
    setReviewing(true);
    try {
      const res = await fetch("/api/marketing/submitted-videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ad.fb_ad_id, reviewed: next }),
      });
      const json = await res.json();
      if (res.ok) {
        setReviewedAt(json.data.reviewed_at);
        setReviewedByName(json.data.reviewed_by_name);
        onReviewedChange(
          ad.fb_ad_id,
          json.data.reviewed_at,
          json.data.reviewed_by_name
        );
      }
    } finally {
      setReviewing(false);
    }
  };

  const isVideoProcessing =
    isVideo && media?.status != null && media.status !== "ready";
  const permalink = media?.permalink ?? null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">{ad.ad_name}</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              by {ad.marketer_name} · {fmtDateTime(ad.created_time)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Media */}
        <div className="bg-black flex items-center justify-center min-h-[300px]">
          {loading ? (
            <Loader2 size={28} className="text-gray-500 animate-spin" />
          ) : error ? (
            <div className="text-center p-8">
              <AlertTriangle size={28} className="mx-auto text-yellow-500 mb-2" />
              <p className="text-gray-300 text-sm">{error}</p>
            </div>
          ) : isVideoProcessing ? (
            <div className="text-center p-8">
              <Loader2 size={28} className="mx-auto text-blue-400 animate-spin mb-2" />
              <p className="text-gray-300 text-sm">
                Facebook is still processing this video. Try again shortly.
              </p>
            </div>
          ) : isVideo && media?.source ? (
            <video
              src={media.source}
              poster={media.thumbnail ?? ad.thumbnail_url ?? undefined}
              controls
              autoPlay
              className="max-h-[60vh] w-full"
            />
          ) : !isVideo && (ad.image_url || ad.thumbnail_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(ad.image_url || ad.thumbnail_url) as string}
              alt={ad.ad_name}
              className="max-h-[60vh] w-full object-contain"
            />
          ) : (
            <div className="text-center p-8">
              <p className="text-gray-400 text-sm">Media unavailable</p>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="p-5 space-y-4">
          {ad.is_scheduled && ad.start_time && (
            <div className="flex items-center gap-2 text-sm bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-lg px-3 py-2">
              <Calendar size={15} />
              Scheduled for {fmtDateTime(ad.start_time)} — not yet live
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Meta label="Marketer" value={ad.marketer_name} />
            <Meta label="Store" value={ad.store_name ?? "—"} />
            <Meta label="Campaign" value={ad.campaign_name ?? "—"} />
            <Meta label="Ad set" value={ad.adset_name ?? "—"} />
            <Meta
              label="Type"
              value={ad.creative_type === "video" ? "Video" : "Image"}
            />
            <Meta label="Status" value={ad.effective_status ?? "—"} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
            <a
              href={`https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.fb_ad_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white"
            >
              <ExternalLink size={14} />
              Open in Ads Manager
            </a>
            {permalink && (
              <a
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white"
              >
                <ExternalLink size={14} />
                View on Facebook
              </a>
            )}

            {role === "admin" && (
              <button
                onClick={toggleReviewed}
                disabled={reviewing}
                className={`ml-auto flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                  reviewedAt
                    ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                    : "bg-white text-gray-900 hover:bg-gray-100"
                }`}
                title={
                  reviewedAt && reviewedByName
                    ? `Reviewed by ${reviewedByName}`
                    : undefined
                }
              >
                {reviewing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : reviewedAt ? (
                  <CheckCircle size={14} />
                ) : (
                  <Circle size={14} />
                )}
                {reviewedAt ? "Reviewed" : "Mark as reviewed"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-gray-200 truncate">{value}</p>
    </div>
  );
}
