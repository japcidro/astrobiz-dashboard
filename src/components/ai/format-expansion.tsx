"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  RefreshCw,
  Copy,
  Save,
  CheckCircle,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

interface Props {
  storeName: string;
  docsReady: number;
}

interface HistoryItem {
  id: string;
  created_at: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
}

export function FormatExpansion({ storeName, docsReady }: Props) {
  const [inputText, setInputText] = useState("");
  const [output, setOutput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [formatCount, setFormatCount] = useState(5);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fetch history for "select from history" dropdown
  useEffect(() => {
    if (!storeName) return;
    (async () => {
      setLoadingHistory(true);
      try {
        const res = await fetch(
          `/api/ai/history?store=${encodeURIComponent(storeName)}&tool_type=scripts`
        );
        if (res.ok) {
          const data = await res.json();
          setHistoryItems(data.items || data || []);
        }
      } catch {
        // Silent fail — history is optional
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [storeName]);

  const handleSelectHistory = (id: string) => {
    const item = historyItems.find((h) => h.id === id);
    if (!item) return;
    const scripts =
      (item.output_data?.scripts as string) ||
      (item.output_data?.text as string) ||
      JSON.stringify(item.output_data);
    setInputText(scripts);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setOutput("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: "formats",
          user_input: inputText,
          count: formatCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate formats");
      }
      const data = await res.json();
      setOutput(data.output || data.text || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate formats");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  const handleSaveToHistory = async () => {
    try {
      const res = await fetch("/api/ai/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: "formats",
          input_data: { winning_script: inputText },
          output_data: { formats: output },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save to history");
    }
  };

  const notReady = docsReady < 8;

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h3 className="text-base font-semibold text-white mb-4">
          Winning Script / Angle
        </h3>

        {/* History selector */}
        {historyItems.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1.5">
              Or select from history
            </label>
            <div className="relative">
              <select
                onChange={(e) => handleSelectHistory(e.target.value)}
                defaultValue=""
                disabled={loadingHistory}
                className="appearance-none w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="" disabled>
                  {loadingHistory
                    ? "Loading history..."
                    : "Select a previous script..."}
                </option>
                {historyItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    — Scripts
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
          </div>
        )}

        {/* Input textarea */}
        <div className="mb-4">
          <label className="block text-sm text-gray-300 mb-1.5">
            Paste your winning script or angle
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={8}
            placeholder="Paste your winning ad script here..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={formatCount}
              onChange={(e) => setFormatCount(Number(e.target.value))}
              className="appearance-none bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} formats
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={notReady || generating || !inputText.trim()}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {generating ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Expanding to formats...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Expand to Formats
              </>
            )}
          </button>
        </div>

        {notReady && (
          <p className="text-xs text-yellow-400 mt-2">
            All 8 knowledge documents must be filled before generating. Currently{" "}
            {docsReady}/8 ready.
          </p>
        )}
      </div>

      {/* Output */}
      {output && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-base font-semibold text-white mb-4">
            Expanded Formats
          </h3>

          <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
            <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
              {output}
            </pre>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} className="text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy All
                </>
              )}
            </button>
            <button
              onClick={handleSaveToHistory}
              disabled={saved}
              className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {saved ? (
                <>
                  <CheckCircle size={14} className="text-green-400" />
                  Saved!
                </>
              ) : (
                <>
                  <Save size={14} />
                  Save to History
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
