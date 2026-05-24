"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Copy,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from "lucide-react";

interface Props {
  storeFilter: string;
  onClose: () => void;
}

interface GenerateResponse {
  markdown: string;
  model: string;
  ad_count: number;
  store: string | null;
  tokens_used: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
}

export function WinnersLogModal({ storeFilter, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs =
        storeFilter && storeFilter !== "ALL"
          ? `?store=${encodeURIComponent(storeFilter)}`
          : "";
      const res = await fetch(
        `/api/marketing/winners-pool/generate-log${qs}`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      setResult(json as GenerateResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => {
    run();
  }, [run]);

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const date = new Date().toISOString().split("T")[0];
    const storeSlug =
      result.store && result.store !== "ALL"
        ? result.store.toLowerCase().replace(/\s+/g, "-")
        : "all";
    const filename = `winners-log-${storeSlug}-${date}.md`;
    const blob = new Blob([result.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-400" />
            <h2 className="text-lg font-semibold text-white">
              Winning &amp; Losing Ads Log
            </h2>
            {result && (
              <span className="text-xs text-gray-500 ml-2">
                {result.ad_count} ad{result.ad_count === 1 ? "" : "s"}
                {result.store && result.store !== "ALL" ? ` · ${result.store}` : ""}
                {" · "}
                {result.model}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-[300px]">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-12">
              <Loader2 size={28} className="animate-spin text-amber-400" />
              <p className="text-sm">Generating the Log document…</p>
              <p className="text-xs text-gray-500 text-center max-w-md">
                Claude Opus 4.7 is reading every tagged ad&apos;s transcript,
                metrics, and deconstruction. Typically 60-120 seconds.
              </p>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Generation failed</p>
                <p className="text-xs mt-1 break-words">{error}</p>
              </div>
              <button
                onClick={run}
                className="text-xs bg-red-700/30 hover:bg-red-700/50 border border-red-700/50 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
              >
                <RefreshCw size={11} />
                Retry
              </button>
            </div>
          )}
          {result && (
            <pre className="whitespace-pre-wrap text-xs text-gray-200 font-mono leading-relaxed bg-gray-950 border border-gray-800 rounded-lg p-4">
              {result.markdown}
            </pre>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between p-4 border-t border-gray-700 flex-shrink-0 gap-2 flex-wrap">
            <div className="text-[11px] text-gray-500">
              {result.tokens_used && (
                <>
                  {(result.tokens_used.input_tokens ?? 0).toLocaleString()} in ·{" "}
                  {(result.tokens_used.output_tokens ?? 0).toLocaleString()} out
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={run}
                className="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
              <button
                onClick={handleCopy}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? (
                  <>
                    <CheckCircle2 size={12} className="text-green-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={handleDownload}
                className="text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={12} />
                Download .md
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
