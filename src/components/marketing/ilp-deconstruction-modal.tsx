"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trophy,
  Info,
  ExternalLink,
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
  const [openZones, setOpenZones] = useState<Set<ZoneId>>(
    new Set(ZONE_ORDER)
  );

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
                Claude Sonnet 4.6 is mapping this ad to ILP frameworks
                (avatar A–E, Bypass Formula audit, compliance check). The
                first run takes 10–30s. Repeat opens on the same ad are
                instant.
              </p>
            </div>
          )}

          {noTranscript && (
            <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300">
              <p className="font-medium text-white mb-2">
                No transcript captured for this ad yet.
              </p>
              <p className="text-gray-400">
                The auto-deconstruct cron picks up top-spend ads daily. Two
                options to get an ILP analysis now:
              </p>
              <ol className="list-decimal pl-5 mt-2 space-y-1 text-gray-400">
                <li>
                  Wait — within 24h the Gemini cron will fetch a transcript,
                  then click this row again.
                </li>
                <li>
                  Paste the transcript directly into the standalone{" "}
                  <a
                    href="/marketing/deconstructor"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    Ad Deconstructor
                  </a>
                  .
                </li>
              </ol>
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
                  ? "Remove from Winners Pool"
                  : "Add to Winners Pool — also tag notable losers; the Log learns from comparison"
              }
            >
              {taggingWinner ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trophy size={12} />
              )}
              {isTaggedWinner ? "In Winners Pool" : "Tag as Winner"}
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
