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
  // Called after a successful reviewed toggle so the list can update in place.
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
  const [media, setMedia] = useState<SubmittedVideoSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | null>(ad.reviewed_at);
  const [reviewedByName, setReviewedByName] = useState<string | null>(
    ad.reviewed_by_name
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/marketing/submitted-videos/source?id=${ad.id}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "Failed to load media");
        } else {
          setMedia(json.data as SubmittedVideoSource);
        }
      } catch {
        if (!cancelled) setError("Failed to load media");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ad.id]);

  // Close on Escape.
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
        body: JSON.stringify({ id: ad.id, reviewed: next }),
      });
      const json = await res.json();
      if (res.ok) {
        setReviewedAt(json.data.reviewed_at);
        setReviewedByName(json.data.reviewed_by_name);
        onReviewedChange(ad.id, json.data.reviewed_at, json.data.reviewed_by_name);
      }
    } finally {
      setReviewing(false);
    }
  };

  const isVideoProcessing =
    ad.creative_type === "video" &&
    media?.status != null &&
    media.status !== "ready";

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
              by {ad.marketer_name} · {fmtDateTime(ad.submitted_at)}
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
          ) : ad.creative_type === "video" && media?.source ? (
            <video
              src={media.source}
              poster={media.thumbnail ?? undefined}
              controls
              autoPlay
              className="max-h-[60vh] w-full"
            />
          ) : media?.source ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.source}
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
          {/* Schedule banner */}
          {ad.start_time && new Date(ad.start_time).getTime() > Date.now() && (
            <div className="flex items-center gap-2 text-sm bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-lg px-3 py-2">
              <Calendar size={15} />
              Scheduled for {fmtDateTime(ad.start_time)} — not yet live
            </div>
          )}

          {/* Ad copy */}
          {(ad.primary_text || ad.headline) && (
            <div className="space-y-2">
              {ad.headline && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">
                    Headline
                  </p>
                  <p className="text-white text-sm">{ad.headline}</p>
                </div>
              )}
              {ad.primary_text && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">
                    Primary Text
                  </p>
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">
                    {ad.primary_text}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Meta label="Marketer" value={ad.marketer_name} />
            <Meta label="Store" value={ad.store_name ?? "—"} />
            <Meta label="File" value={ad.file_name ?? "—"} />
            <Meta
              label="Type"
              value={ad.creative_type === "video" ? "Video" : "Image"}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
            {ad.fb_ad_id && (
              <a
                href={`https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.fb_ad_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white"
              >
                <ExternalLink size={14} />
                Open in Ads Manager
              </a>
            )}
            {media?.permalink && (
              <a
                href={media.permalink}
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
