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
  FileText,
  Copy,
  Check,
  MessageSquare,
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
  onNoteChange: (
    id: string,
    note: string | null,
    noteByName: string | null
  ) => void;
}

function fmtPeso(n: number): string {
  return `₱${Math.round(n).toLocaleString("en-PH")}`;
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

export function VideoReviewModal({
  ad,
  role,
  onClose,
  onReviewedChange,
  onNoteChange,
}: Props) {
  const isVideo = ad.creative_type === "video";
  const [media, setMedia] = useState<SubmittedVideoSource | null>(null);
  const [loading, setLoading] = useState(isVideo);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | null>(ad.reviewed_at);
  const [reviewedByName, setReviewedByName] = useState<string | null>(
    ad.reviewed_by_name
  );

  // Lifetime results (FB Insights) — spend + purchases. null = still loading.
  const [results, setResults] = useState<{
    has_data: boolean;
    spend: number;
    purchases: number;
    revenue: number;
    roas: number;
    cpp: number;
  } | null>(null);
  const [resultsLoading, setResultsLoading] = useState(true);

  // Transcript (Gemini, transcript-only — generated on demand, then cached).
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);

  // Note / comment on the creative.
  const [note, setNote] = useState<string>(ad.note ?? "");
  const [noteByName, setNoteByName] = useState<string | null>(ad.note_by_name);
  const [noteAt, setNoteAt] = useState<string | null>(ad.note_at);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

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

  // On open, fetch lifetime spend + purchases for this ad.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setResultsLoading(true);
      try {
        const res = await fetch(
          `/api/marketing/submitted-videos/insights?fb_ad_id=${ad.fb_ad_id}`
        );
        const json = await res.json();
        if (!cancelled && res.ok) setResults(json.data);
      } catch {
        // ignore — results just won't show
      } finally {
        if (!cancelled) setResultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ad.fb_ad_id]);

  // On open, check for an already-cached transcript (no AI call).
  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/marketing/submitted-videos/transcript?fb_ad_id=${ad.fb_ad_id}`
        );
        const json = await res.json();
        if (!cancelled && res.ok && json.data?.transcript) {
          setTranscript(json.data.transcript as string);
        }
      } catch {
        // ignore — user can still generate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ad.fb_ad_id, isVideo]);

  const generateTranscript = async () => {
    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const res = await fetch("/api/marketing/submitted-videos/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fb_ad_id: ad.fb_ad_id,
          account_id: ad.ad_account_id || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) setTranscriptError(json.error || "Transcription failed");
      else setTranscript(json.data.transcript as string);
    } catch {
      setTranscriptError("Transcription failed");
    } finally {
      setTranscriptLoading(false);
    }
  };

  // One-click copy of the full ad summary (details + results + transcript)
  // — formatted for pasting straight into an AI for analysis.
  const copyDetails = async () => {
    const r = results;
    const resultsBlock =
      r && r.has_data
        ? [
            `- Spend: ${fmtPeso(r.spend)}`,
            `- Purchases: ${r.purchases}`,
            `- Cost per Purchase: ${r.cpp > 0 ? fmtPeso(r.cpp) : "—"}`,
            `- ROAS: ${r.roas > 0 ? `${r.roas.toFixed(2)}x` : "—"}`,
          ].join("\n")
        : "- No results yet (not yet delivering)";

    const lines: (string | null)[] = [
      `Ad: ${ad.ad_name}`,
      `Marketer: ${ad.marketer_name}`,
      ad.store_name ? `Store: ${ad.store_name}` : null,
      ad.campaign_name ? `Campaign: ${ad.campaign_name}` : null,
      ad.adset_name ? `Ad set: ${ad.adset_name}` : null,
      ad.effective_status ? `Status: ${ad.effective_status}` : null,
      ad.created_time ? `Created: ${fmtDateTime(ad.created_time)}` : null,
      "",
      "Results (lifetime):",
      resultsBlock,
    ];
    if (transcript) {
      lines.push("", "Transcript:", transcript);
    }
    try {
      await navigator.clipboard.writeText(
        lines.filter((l) => l !== null).join("\n")
      );
      setCopiedDetails(true);
      setTimeout(() => setCopiedDetails(false), 1500);
    } catch {
      // clipboard may be blocked — ignore
    }
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked — ignore
    }
  };

  const saveNote = async () => {
    setSavingNote(true);
    setNoteSaved(false);
    try {
      const res = await fetch("/api/marketing/submitted-videos/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fb_ad_id: ad.fb_ad_id, note }),
      });
      const json = await res.json();
      if (res.ok) {
        setNoteByName(json.data.note_by_name);
        setNoteAt(json.data.note_at);
        onNoteChange(ad.fb_ad_id, json.data.note, json.data.note_by_name);
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 1500);
      }
    } finally {
      setSavingNote(false);
    }
  };

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
          ) : ad.image_url || ad.thumbnail_url || media?.thumbnail ? (
            // Image ad, or a video whose inline source couldn't be resolved —
            // show the thumbnail so there's never a bare error, and point to FB.
            <div className="relative w-full flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  (ad.image_url || ad.thumbnail_url || media?.thumbnail) as string
                }
                alt={ad.ad_name}
                className="max-h-[60vh] w-full object-contain"
              />
              {isVideo && (
                <div className="absolute bottom-0 inset-x-0 bg-black/70 text-gray-200 text-xs text-center py-2 px-3">
                  Couldn&apos;t load the video inline — use &ldquo;View on
                  Facebook&rdquo; or &ldquo;Open in Ads Manager&rdquo; below to
                  watch.
                </div>
              )}
            </div>
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

          {/* Results (lifetime spend + purchases from FB) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-gray-500">
                Results (lifetime)
              </p>
              <button
                onClick={copyDetails}
                title="Copy ad details, results, and transcript for AI"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white cursor-pointer"
              >
                {copiedDetails ? <Check size={13} /> : <Copy size={13} />}
                {copiedDetails ? "Copied" : "Copy all"}
              </button>
            </div>
            {resultsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
                <Loader2 size={14} className="animate-spin" />
                Loading results…
              </div>
            ) : results?.has_data ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="Spend" value={fmtPeso(results.spend)} />
                <Stat label="Purchases" value={String(results.purchases)} />
                <Stat
                  label="Cost / Purchase"
                  value={results.cpp > 0 ? fmtPeso(results.cpp) : "—"}
                />
                <Stat
                  label="ROAS"
                  value={results.roas > 0 ? `${results.roas.toFixed(2)}x` : "—"}
                />
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Walang results pa — hindi pa nagde-deliver (scheduled o bago lang).
              </p>
            )}
          </div>

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

          {/* Note / comment */}
          <div className="border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                <MessageSquare size={13} />
                Note
              </p>
              {noteAt && noteByName && (
                <span className="text-[11px] text-gray-600">
                  by {noteByName} · {fmtDateTime(noteAt)}
                </span>
              )}
            </div>

            {role === "admin" ? (
              <div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note about this creative…"
                  rows={3}
                  className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-y"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={saveNote}
                    disabled={savingNote}
                    className="flex items-center gap-1.5 text-sm font-medium bg-white text-gray-900 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingNote ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : noteSaved ? (
                      <Check size={14} />
                    ) : null}
                    {noteSaved ? "Saved" : "Save note"}
                  </button>
                  {note.trim() && (
                    <span className="text-[11px] text-gray-600">
                      Clearing the box and saving removes the note.
                    </span>
                  )}
                </div>
              </div>
            ) : note.trim() ? (
              <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-3 text-sm text-gray-200 whitespace-pre-wrap">
                {note}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No note yet.</p>
            )}
          </div>

          {/* Transcript (video only) */}
          {isVideo && (
            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <FileText size={13} />
                  Transcript
                </p>
                {transcript && (
                  <button
                    onClick={copyTranscript}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white cursor-pointer"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>

              {transcript ? (
                <div className="max-h-56 overflow-y-auto bg-gray-800/60 border border-gray-700/60 rounded-lg p-3 text-sm text-gray-200 whitespace-pre-wrap">
                  {transcript}
                </div>
              ) : transcriptLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 size={15} className="animate-spin" />
                  Transcribing… puwedeng abutin ng ilang segundo hanggang ~1-2 min
                  para sa mahabang video.
                </div>
              ) : (
                <div>
                  <button
                    onClick={generateTranscript}
                    className="flex items-center gap-1.5 text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    <FileText size={14} />
                    Get transcript
                  </button>
                  <p className="text-[11px] text-gray-600 mt-1.5">
                    Verbatim transcript via Gemini Flash — maliit na AI cost
                    (~₱1–3 per video), tapos naka-cache na (libre na pag-ulit).
                  </p>
                  {transcriptError && (
                    <p className="text-xs text-red-400 mt-1.5">{transcriptError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-800">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-white text-base font-semibold mt-0.5">{value}</p>
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
