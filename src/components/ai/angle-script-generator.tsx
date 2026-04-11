"use client";

import { useState } from "react";
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

export function AngleScriptGenerator({ storeName, docsReady }: Props) {
  const [angles, setAngles] = useState<string[]>([]);
  const [selectedAngles, setSelectedAngles] = useState<Set<number>>(new Set());
  const [scripts, setScripts] = useState("");
  const [generatingAngles, setGeneratingAngles] = useState(false);
  const [generatingScripts, setGeneratingScripts] = useState(false);
  const [angleCount, setAngleCount] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleGenerateAngles = async () => {
    setGeneratingAngles(true);
    setError(null);
    setAngles([]);
    setSelectedAngles(new Set());
    setScripts("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: "angles",
          user_input: "",
          count: angleCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate angles");
      }
      const data = await res.json();
      const text: string = data.output || data.text || "";
      // Parse numbered list: "1. ...", "2. ...", etc.
      const parsed = text
        .split(/\n/)
        .map((line: string) => line.replace(/^\d+[\.\)]\s*/, "").trim())
        .filter((line: string) => line.length > 0);
      setAngles(parsed.length > 0 ? parsed : [text]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate angles");
    } finally {
      setGeneratingAngles(false);
    }
  };

  const toggleAngle = (index: number) => {
    setSelectedAngles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedAngles.size === angles.length) {
      setSelectedAngles(new Set());
    } else {
      setSelectedAngles(new Set(angles.map((_, i) => i)));
    }
  };

  const getSelectedAnglesText = () =>
    Array.from(selectedAngles)
      .sort()
      .map((i) => `${i + 1}. ${angles[i]}`)
      .join("\n");

  const handleGenerateScripts = async () => {
    setGeneratingScripts(true);
    setError(null);
    setScripts("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          tool_type: "scripts",
          user_input: getSelectedAnglesText(),
          count: selectedAngles.size,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate scripts");
      }
      const data = await res.json();
      setScripts(data.output || data.text || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate scripts");
    } finally {
      setGeneratingScripts(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scripts);
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
          tool_type: "scripts",
          input_data: {
            angles: Array.from(selectedAngles).map((i) => angles[i]),
          },
          output_data: { scripts },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save to history");
    }
  };

  const notReady = docsReady < 7;

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Step 1: Generate Angles */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600/30 text-emerald-400 text-xs font-bold">
            1
          </div>
          <h3 className="text-base font-semibold text-white">
            Generate Angles
          </h3>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative">
            <select
              value={angleCount}
              onChange={(e) => setAngleCount(Number(e.target.value))}
              className="appearance-none bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} angles
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
          <button
            onClick={handleGenerateAngles}
            disabled={notReady || generatingAngles}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {generatingAngles ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Generating angles...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate Angles
              </>
            )}
          </button>
        </div>

        {notReady && (
          <p className="text-xs text-yellow-400">
            All 7 knowledge documents must be filled before generating. Currently{" "}
            {docsReady}/7 ready.
          </p>
        )}

        {/* Angles List */}
        {angles.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-300">
                {selectedAngles.size} of {angles.length} selected
              </p>
              <button
                onClick={selectAll}
                className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                {selectedAngles.size === angles.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>
            {angles.map((angle, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedAngles.has(i)
                    ? "bg-emerald-900/20 border border-emerald-700/50"
                    : "bg-gray-700/30 border border-transparent hover:bg-gray-700/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedAngles.has(i)}
                  onChange={() => toggleAngle(i)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-600 bg-gray-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm text-gray-200">{angle}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Generate Scripts */}
      {angles.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600/30 text-emerald-400 text-xs font-bold">
              2
            </div>
            <h3 className="text-base font-semibold text-white">
              Generate Scripts
            </h3>
          </div>

          <button
            onClick={handleGenerateScripts}
            disabled={selectedAngles.size === 0 || generatingScripts}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer mb-4"
          >
            {generatingScripts ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Generating scripts...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate Scripts for {selectedAngles.size} Angle
                {selectedAngles.size !== 1 ? "s" : ""}
              </>
            )}
          </button>

          {selectedAngles.size === 0 && (
            <p className="text-xs text-gray-500">
              Select at least one angle above to generate scripts.
            </p>
          )}

          {/* Scripts Output */}
          {scripts && (
            <div className="mt-4 space-y-4">
              <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
                <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                  {scripts}
                </pre>
              </div>

              <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}
