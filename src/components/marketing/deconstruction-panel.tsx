"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Video,
  Loader2,
  Play,
  RefreshCw,
  AlertCircle,
  X,
  Search,
  Wand2,
} from "lucide-react";

interface AdBrief {
  ad_id: string;
  ad: string;
  account: string;
  account_id: string;
  campaign: string;
  adset: string;
  spend: number;
  purchases: number;
  roas: number;
  thumbnail_url: string | null;
}

export interface DeconstructionRow {
  id: string;
  ad_id: string;
  account_id: string;
  thumbnail_url: string | null;
  analysis: Analysis;
  model: string | null;
  trigger_source: string;
  created_at: string;
  analyzed_by_name: string | null;
}

interface Analysis {
  transcript: string;
  hook: { description: string; timestamp: string };
  scenes: Array<{ t: string; description: string }>;
  visual_style: string;
  tone: string;
  cta: string;
  language: string;
  duration_seconds: number;
}

interface Props {
  ads: AdBrief[];
  initialAdId?: string | null;
  onAutoAnalyzeHandled?: () => void;
}

export function DeconstructionPanel({
  ads,
  initialAdId,
  onAutoAnalyzeHandled,
}: Props) {
  const [rows, setRows] = useState<DeconstructionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedAdId, setSelectedAdId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<DeconstructionRow | null>(null);

  const adMap = useMemo(() => {
    const m = new Map<string, AdBrief>();
    for (const a of ads) m.set(a.ad_id, a);
    return m;
  }, [ads]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/marketing/ai-analytics/deconstructions");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setRows((json.rows as DeconstructionRow[]) ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const runAnalyze = useCallback(
    async (adId: string, forceRefresh = false) => {
      const ad = adMap.get(adId);
      if (!ad) {
        setAnalyzeError(
          "Pick an ad from the list — that ad is not in the current view."
        );
        return;
      }
      setAnalyzing(true);
      setAnalyzeError(null);
      try {
        const res = await fetch(
          "/api/marketing/ai-analytics/deconstruct",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ad_id: adId,
              account_id: ad.account_id,
              force_refresh: forceRefresh,
              trigger_source: "on_demand",
            }),
          }
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Analyze failed (${res.status})`);
        }
        // Refresh list + open the new row
        await loadList();
        if (json.row) setActiveRow(json.row as DeconstructionRow);
      } catch (e) {
        setAnalyzeError(e instanceof Error ? e.message : "Analyze failed");
      } finally {
        setAnalyzing(false);
      }
    },
    [adMap, loadList]
  );

  // Deep-link: if the page was loaded with ?deconstruct_ad=ID, trigger once.
  useEffect(() => {
    if (!initialAdId) return;
    if (ads.length === 0) return;
    setSelectedAdId(initialAdId);
    runAnalyze(initialAdId).finally(() => {
      onAutoAnalyzeHandled?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAdId, ads.length]);

  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const ad = adMap.get(r.ad_id);
      return (
        r.ad_id.toLowerCase().includes(q) ||
        (ad?.ad ?? "").toLowerCase().includes(q) ||
        (ad?.campaign ?? "").toLowerCase().includes(q) ||
        r.analysis?.tone?.toLowerCase().includes(q) ||
        r.analysis?.visual_style?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, adMap]);

  const alreadyAnalyzedIds = useMemo(
    () => new Set(rows.map((r) => r.ad_id)),
    [rows]
  );

  return (
    <div className="space-y-4">
      {/* Analyze new ad */}
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wand2 size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">
            Analyze an ad video
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedAdId}
            onChange={(e) => setSelectedAdId(e.target.value)}
            disabled={analyzing || ads.length === 0}
            className="flex-1 min-w-[260px] bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          >
            <option value="">
              {ads.length === 0
                ? "Loading ads…"
                : "Pick an ad to analyze…"}
            </option>
            {ads.map((a) => (
              <option key={a.ad_id} value={a.ad_id}>
                {alreadyAnalyzedIds.has(a.ad_id) ? "✓ " : ""}
                {a.ad} · ₱{a.spend.toFixed(0)} · ROAS{" "}
                {a.roas.toFixed(2)}
              </option>
            ))}
          </select>
          <button
            onClick={() => runAnalyze(selectedAdId)}
            disabled={!selectedAdId || analyzing}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {analyzing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
          {selectedAdId && alreadyAnalyzedIds.has(selectedAdId) && (
            <button
              onClick={() => runAnalyze(selectedAdId, true)}
              disabled={analyzing}
              title="Force re-analyze (ignores 7-day cache)"
              className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw size={14} />
              Re-run
            </button>
          )}
        </div>
        {analyzing && (
          <p className="text-xs text-gray-500 mt-2">
            Downloading video + running Gemini analysis. Takes ~20-40 seconds.
            Do not close the tab.
          </p>
        )}
        {analyzeError && (
          <div className="mt-3 p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>{analyzeError}</div>
          </div>
        )}
      </div>

      {/* Cached analyses */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-300">
            Past analyses ({rows.length})
          </h3>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg pl-8 pr-3 py-1.5 focus:ring-blue-500 focus:border-blue-500 w-48"
            />
          </div>
        </div>

        {listError && (
          <div className="mb-3 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {listError}
          </div>
        )}

        {loadingList ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="animate-spin text-gray-500" size={20} />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="bg-gray-900/30 border border-gray-700/40 rounded-xl p-10 text-center">
            <Video size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
              {rows.length === 0
                ? "No analyses yet. Pick an ad above to run your first deconstruction."
                : "No analyses match your search."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredRows.map((r) => {
              const ad = adMap.get(r.ad_id);
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRow(r)}
                  className="text-left bg-gray-900/50 border border-gray-700/50 hover:border-gray-500 rounded-xl overflow-hidden transition-colors cursor-pointer"
                >
                  <div className="aspect-video bg-gray-800 relative">
                    {r.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video size={28} className="text-gray-600" />
                      </div>
                    )}
                    {r.trigger_source === "auto_daily" && (
                      <span className="absolute top-2 right-2 bg-purple-600/80 text-white text-[10px] px-2 py-0.5 rounded">
                        Auto
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm text-white font-medium truncate">
                      {ad?.ad ?? r.ad_id}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {ad?.campaign ?? "—"}
                    </p>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-gray-400">
                      <span>{r.analysis.language || "—"}</span>
                      <span>
                        {new Date(r.created_at).toLocaleDateString("en-PH", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeRow && (
        <DeconstructionDetailModal
          row={activeRow}
          adName={adMap.get(activeRow.ad_id)?.ad ?? null}
          onClose={() => setActiveRow(null)}
          onRerun={() => runAnalyze(activeRow.ad_id, true)}
          rerunning={analyzing}
        />
      )}
    </div>
  );
}

function DeconstructionDetailModal({
  row,
  adName,
  onClose,
  onRerun,
  rerunning,
}: {
  row: DeconstructionRow;
  adName: string | null;
  onClose: () => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const a = row.analysis;
  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="flex items-start gap-3 min-w-0">
            {row.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.thumbnail_url}
                alt=""
                className="w-20 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white truncate">
                {adName ?? row.ad_id}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
                <span>{a.duration_seconds}s</span>
                <span>•</span>
                <span>{a.language}</span>
                <span>•</span>
                <span>
                  {new Date(row.created_at).toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {row.analyzed_by_name && (
                  <>
                    <span>•</span>
                    <span>by {row.analyzed_by_name}</span>
                  </>
                )}
                {row.trigger_source === "auto_daily" && (
                  <span className="bg-purple-600/20 text-purple-300 text-[10px] px-2 py-0.5 rounded">
                    Auto
                  </span>
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
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <Section title="Hook (first 3 seconds)">
            <p className="text-xs text-gray-500 mb-1 font-mono">
              {a.hook.timestamp}
            </p>
            <p className="text-sm text-gray-200">{a.hook.description}</p>
          </Section>

          <Section title="Visual style">
            <p className="text-sm text-gray-200">{a.visual_style}</p>
          </Section>

          <Section title="Tone">
            <p className="text-sm text-gray-200">{a.tone}</p>
          </Section>

          <Section title="CTA">
            <p className="text-sm text-gray-200">{a.cta}</p>
          </Section>

          <Section title="Scene / b-roll changes">
            {a.scenes.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                No distinct scene changes identified.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {a.scenes.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-blue-400 font-mono text-xs pt-0.5 w-12 flex-shrink-0">
                      {s.t}
                    </span>
                    <span className="text-gray-200">{s.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Full transcript">
            <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 leading-relaxed">
              {a.transcript}
            </pre>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <span className="text-xs text-gray-500">
            Model: {row.model ?? "unknown"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onRerun}
              disabled={rerunning}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40 cursor-pointer"
            >
              {rerunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Re-run
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
        {title}
      </h4>
      {children}
    </div>
  );
}
