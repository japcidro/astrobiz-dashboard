"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trophy,
  Info,
  ExternalLink,
  Wand2,
} from "lucide-react";
import {
  ComplianceFlagsBadge,
  ZONE_ORDER,
  ZoneList,
  type ZonesRecord,
} from "@/components/marketing/ilp-zone-renderer";
import type { ZoneId } from "@/lib/ai/ilp-deconstruct-parser";

interface DeconstructionResult {
  id: string | null;
  zones: ZonesRecord;
  ad_origin: string | null;
  ad_title: string | null;
  compliance_flags_count: number;
  one_takeaway: string | null;
  model: string;
  tokens_used: { input_tokens?: number; output_tokens?: number } | null;
  cached: boolean;
}

interface Props {
  adId: string;
  // FB ad account id (e.g. "act_123…") — passed through to the transcribe
  // endpoint so resolveAdVideo can scope its creative lookup. Optional;
  // resolveAdVideo will still try without it but is more reliable with.
  accountId: string | null;
  adName: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  isTaggedWinner: boolean;
  taggingWinner: boolean;
  onToggleWinnerTag: () => void;
  onClose: () => void;
}

// Replaces the legacy DeconstructionDetailModal. When a Creatives row is
// clicked, this modal opens, fetches the ad's captured transcript from
// ad_creative_analyses, and runs the ILP 8-zone deconstruction via Claude
// Sonnet 4.6 — dedupes against ilp_deconstructions by transcript hash so
// repeat clicks on the same ad are free.
export function IlpDeconstructionModal({
  adId,
  accountId,
  adName,
  thumbnailUrl,
  previewUrl,
  isTaggedWinner,
  taggingWinner,
  onToggleWinnerTag,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<DeconstructionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noTranscript, setNoTranscript] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [openZones, setOpenZones] = useState<Set<ZoneId>>(
    new Set(ZONE_ORDER)
  );
  // Stays true while mounted; the transcribe poll loop checks this so it
  // never calls setState after the modal closes.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      setNoTranscript(false);
      if (!force) setResult(null);
      try {
        const res = await fetch(
          "/api/marketing/deconstructor/from-analysis",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ad_id: adId, ad_title: adName }),
          }
        );
        const json = await res.json();
        if (!res.ok) {
          if (json.no_transcript) {
            setNoTranscript(true);
          } else {
            throw new Error(json.error || "Deconstruction failed");
          }
          return;
        }
        setResult(json as DeconstructionResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Deconstruction failed");
      } finally {
        setLoading(false);
      }
    },
    [adId, adName]
  );

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adId]);

  // On-demand: Gemini-transcribes this single ad now, then runs the
  // 8-zone Claude analysis immediately after. Used when the daily cron
  // hasn't picked up this ad yet (new ad / low spend / missed top-N).
  const transcribeNow = useCallback(async () => {
    if (transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);

    // The transcribe request (FB download + Gemini, up to ~300s) can outlive
    // the browser's connection: the function keeps running and saves the
    // transcript even after the client sees "Failed to fetch". So we treat a
    // dropped connection as "maybe still processing" and poll for the result,
    // instead of lying to the user that it failed. A real API error (no video,
    // bad token, Gemini rejected the clip) comes back with a message — surface
    // that and stop.
    let networkDropped = false;
    try {
      const res = await fetch(
        "/api/marketing/deconstructor/transcribe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_id: adId, account_id: accountId }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Transcribe failed");
      }
      // Fast path: transcribe returned before the connection dropped.
      // Transcript now exists in ad_creative_analyses — run the 8-zone
      // Claude analysis against it.
      await run();
      if (aliveRef.current) setTranscribing(false);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transcribe failed";
      networkDropped =
        /failed to fetch|load failed|networkerror|fetch failed|terminated/i.test(
          msg
        );
      if (!networkDropped) {
        if (aliveRef.current) {
          setTranscribeError(msg);
          setTranscribing(false);
        }
        return;
      }
    }

    // Connection dropped mid-flight. Poll from-analysis until the transcript
    // the function is still writing shows up (or we give up after the
    // function's own 300s ceiling, plus margin).
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      if (!aliveRef.current) return;
      try {
        const res = await fetch(
          "/api/marketing/deconstructor/from-analysis",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ad_id: adId, ad_title: adName }),
          }
        );
        const json = await res.json();
        if (res.ok) {
          if (!aliveRef.current) return;
          setResult(json as DeconstructionResult);
          setNoTranscript(false);
          setTranscribeError(null);
          setTranscribing(false);
          return;
        }
        // Still no_transcript → the function hasn't finished writing. Wait.
      } catch {
        // Transient network blip — keep polling.
      }
    }
    if (!aliveRef.current) return;
    setTranscribeError(
      "Matagal ang deconstruct na ito (malaking video). Patuloy itong tumatakbo sa likod — isara at buksan ulit ang modal sa loob ng ilang minuto para makita ang resulta."
    );
    setTranscribing(false);
  }, [adId, accountId, adName, run, transcribing]);

  const toggleZone = (id: ZoneId) =>
    setOpenZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-700 flex-shrink-0 gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt=""
                className="w-16 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-white truncate">
                {adName || result?.ad_title || adId}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {result && (
                  <ComplianceFlagsBadge
                    count={result.compliance_flags_count}
                  />
                )}
                {result?.ad_origin && (
                  <span className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700 rounded px-2 py-0.5">
                    {result.ad_origin}
                  </span>
                )}
                {result?.cached && (
                  <span
                    className="text-[10px] bg-gray-800 text-gray-500 border border-gray-700 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                    title="Cached — reusing prior ILP analysis for this transcript"
                  >
                    <Info size={9} />
                    Cached
                  </span>
                )}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-gray-400 hover:text-white inline-flex items-center gap-1"
                  >
                    <ExternalLink size={9} />
                    Open ad
                  </a>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[300px] space-y-2">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-16">
              <Loader2 size={28} className="animate-spin text-emerald-400" />
              <p className="text-sm">Running the 8-zone deconstruction…</p>
              <p className="text-xs text-gray-500 text-center max-w-md">
                Claude Sonnet 4.6 is deconstructing this ad — hook, structure,
                avatar, mechanism, and compliance. I Love Patches ads get the
                full ILP framework; other brands get a brand-neutral
                breakdown. First run takes 10–30s; repeat opens are instant.
              </p>
            </div>
          )}

          {noTranscript && !transcribing && (
            <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300">
              <p className="font-medium text-white mb-2">
                No transcript captured for this ad yet.
              </p>
              <p className="text-gray-400">
                The auto-deconstruct cron picks up top-spend ads daily. You
                can also force a transcript right now:
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={transcribeNow}
                  disabled={transcribing}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  title="Force Gemini to transcribe this ad now, then run the 8-zone analysis. Takes 30–90 seconds."
                >
                  <Wand2 size={12} />
                  Deconstruct now
                </button>
                <span className="text-[11px] text-gray-500">
                  Or wait for the daily cron / paste the transcript into the
                  standalone{" "}
                  <a
                    href="/marketing/deconstructor"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    Ad Deconstructor
                  </a>
                  .
                </span>
              </div>
              {transcribeError && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-xs">
                  <p className="font-medium">Deconstruct failed</p>
                  <p className="mt-1 break-words">{transcribeError}</p>
                </div>
              )}
            </div>
          )}

          {transcribing && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-16">
              <Loader2 size={28} className="animate-spin text-emerald-400" />
              <p className="text-sm">Transcribing video with Gemini…</p>
              <p className="text-xs text-gray-500 text-center max-w-md">
                Downloading the FB video and running Gemini Vision over it.
                Usually 30–90s depending on video size. Claude&apos;s 8-zone
                analysis kicks in automatically right after.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Deconstruction failed</p>
                <p className="text-xs mt-1 break-words">{error}</p>
              </div>
              <button
                onClick={() => run()}
                className="text-xs bg-red-700/30 hover:bg-red-700/50 border border-red-700/50 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
              >
                <RefreshCw size={11} />
                Retry
              </button>
            </div>
          )}

          {result && (
            <ZoneList
              zones={result.zones}
              openZones={openZones}
              onToggle={toggleZone}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-gray-700 flex-shrink-0 gap-2 flex-wrap">
          <div className="text-[11px] text-gray-500 truncate">
            {result?.tokens_used && (
              <>
                {result.model} ·{" "}
                {(result.tokens_used.input_tokens ?? 0).toLocaleString()} in /{" "}
                {(result.tokens_used.output_tokens ?? 0).toLocaleString()} out
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {result && (
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Force a fresh Claude run, ignoring the cached deconstruction"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            )}
            <button
              onClick={onToggleWinnerTag}
              disabled={taggingWinner}
              className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
                isTaggedWinner
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25"
                  : "bg-amber-600 hover:bg-amber-500 text-white"
              }`}
              title={
                isTaggedWinner
                  ? "Remove from Log Pool"
                  : "Add to Log Pool — tag winners AND notable losers; the Log learns from comparison"
              }
            >
              {taggingWinner ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trophy size={12} />
              )}
              {isTaggedWinner ? "In Log Pool" : "Add to Log Pool"}
            </button>
            <button
              onClick={onClose}
              className="text-sm text-gray-300 hover:text-white px-3 py-1.5 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
