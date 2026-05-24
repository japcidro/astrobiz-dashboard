"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  History,
} from "lucide-react";
import {
  ZONE_ORDER,
  ZoneList,
  ComplianceFlagsBadge,
  type ZonesRecord,
} from "@/components/marketing/ilp-zone-renderer";
import type { ZoneId } from "@/lib/ai/ilp-deconstruct-parser";

interface HistoryItem {
  id: string;
  ad_origin: string | null;
  ad_title: string | null;
  compliance_flags_count: number;
  model: string | null;
  created_at: string;
}

interface DeconstructionResult {
  id?: string;
  markdown: string;
  zones: ZonesRecord;
  ad_origin: string | null;
  ad_title: string | null;
  compliance_flags_count: number;
  one_takeaway: string | null;
  model: string;
  tokens_used: { input_tokens?: number; output_tokens?: number } | null;
}

export default function DeconstructorPage() {
  const [sourceText, setSourceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeconstructionResult | null>(null);
  const [openZones, setOpenZones] = useState<Set<ZoneId>>(
    new Set(ZONE_ORDER)
  );

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/marketing/deconstructor");
      const json = await res.json();
      if (res.ok) setHistory(json.history ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDeconstruct = useCallback(async () => {
    const text = sourceText.trim();
    if (!text) {
      setError("Paste an ad transcript first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/marketing/deconstructor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_text: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Deconstruction failed");
      setResult(json as DeconstructionResult);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deconstruction failed");
    } finally {
      setLoading(false);
    }
  }, [sourceText, loadHistory]);

  const loadFromHistory = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/marketing/deconstructor/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      const d = json.deconstruction;
      setSourceText(d.source_text);
      setResult({
        id: d.id,
        markdown: "", // server doesn't return markdown — derive from zones if needed
        zones: d.zones,
        ad_origin: d.ad_origin,
        ad_title: d.ad_title,
        compliance_flags_count: d.compliance_flags_count,
        one_takeaway: null,
        model: d.model,
        tokens_used: d.tokens_used,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this deconstruction?")) return;
      try {
        await fetch(`/api/marketing/deconstructor/${id}`, { method: "DELETE" });
        loadHistory();
        if (result?.id === id) setResult(null);
      } catch {
        /* non-fatal */
      }
    },
    [loadHistory, result?.id]
  );

  const toggleZone = (id: ZoneId) =>
    setOpenZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Ad Deconstructor</h1>
            <p className="text-gray-400 text-sm">
              ILP-native ad deconstruction. Paste any ad transcript — competitor,
              draft, or reference — and get an 8-zone report with compliance audit.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 overflow-hidden">
        <div className="flex flex-col gap-3 overflow-hidden min-w-0">
          {/* Input */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <label className="block text-xs font-medium text-gray-400 uppercase mb-2">
              Ad transcript
            </label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste the ad transcript (and scene log / on-screen text if you have them)."
              rows={6}
              disabled={loading}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y font-mono disabled:opacity-50 min-h-[120px]"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-gray-500">
                {sourceText.length.toLocaleString()} chars · Claude Sonnet 4.6
              </p>
              <button
                onClick={handleDeconstruct}
                disabled={loading || !sourceText.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Deconstructing…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Deconstruct
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">{error}</div>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-300 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Output */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading && !result && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                <Loader2
                  size={28}
                  className="animate-spin text-emerald-400"
                />
                <p className="text-sm">Running the 8-zone deconstruction…</p>
                <p className="text-xs text-gray-500 text-center max-w-md">
                  Sonnet 4.6 is mapping the ad to ILP frameworks, building the
                  avatar, and running the compliance audit. Typically 10-30s.
                </p>
              </div>
            )}

            {result && <ResultHeader result={result} />}

            {result && (
              <ZoneList
                zones={result.zones}
                openZones={openZones}
                onToggle={toggleZone}
              />
            )}
          </div>
        </div>

        {/* History sidebar */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-700/50 flex items-center gap-2">
            <History size={14} className="text-gray-400" />
            <p className="text-xs font-medium text-gray-400 uppercase flex-1">
              History
            </p>
            <button
              onClick={loadHistory}
              className="text-gray-500 hover:text-white cursor-pointer"
              title="Refresh"
            >
              <RefreshCw
                size={12}
                className={historyLoading ? "animate-spin" : ""}
              />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {history.length === 0 && !historyLoading && (
              <p className="text-[11px] text-gray-500 text-center py-6">
                No deconstructions yet.
              </p>
            )}
            {history.map((h) => (
              <div
                key={h.id}
                className={`group rounded-md p-2 hover:bg-gray-700/40 cursor-pointer ${
                  result?.id === h.id ? "bg-emerald-900/20" : ""
                }`}
                onClick={() => loadFromHistory(h.id)}
              >
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate font-medium">
                      {h.ad_title ?? "Untitled"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-500">
                      {h.ad_origin && (
                        <span className="bg-gray-700/60 px-1 py-0.5 rounded">
                          {h.ad_origin}
                        </span>
                      )}
                      {h.compliance_flags_count > 0 ? (
                        <span className="text-red-400 inline-flex items-center gap-0.5">
                          <ShieldAlert size={9} />
                          {h.compliance_flags_count}
                        </span>
                      ) : (
                        <span className="text-green-500/70 inline-flex items-center gap-0.5">
                          <ShieldCheck size={9} />0
                        </span>
                      )}
                      <span className="ml-auto">{timeAgo(h.created_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(h.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultHeader({ result }: { result: DeconstructionResult }) {
  return (
    <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium truncate">
          {result.ad_title ?? "Deconstructed Ad"}
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {result.model} · {result.ad_origin ?? "Origin not classified"}
          {result.tokens_used && (
            <>
              {" · "}
              {(result.tokens_used.input_tokens ?? 0).toLocaleString()} in /{" "}
              {(result.tokens_used.output_tokens ?? 0).toLocaleString()} out
            </>
          )}
        </p>
      </div>
      <ComplianceFlagsBadge count={result.compliance_flags_count} />
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
