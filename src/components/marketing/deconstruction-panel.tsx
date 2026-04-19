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
  CheckCircle2,
  Eye,
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

type SortKey = "purchases" | "spend" | "roas";

const INITIAL_VISIBLE = 12;
const LOAD_MORE_STEP = 12;

const SORT_LABELS: Record<SortKey, string> = {
  purchases: "Purchases",
  spend: "Spend",
  roas: "ROAS",
};

function money(n: number): string {
  if (n >= 1000) return `₱${(n / 1000).toFixed(1)}k`;
  return `₱${Math.round(n)}`;
}

export function DeconstructionPanel({
  ads,
  initialAdId,
  onAutoAnalyzeHandled,
}: Props) {
  const [rows, setRows] = useState<DeconstructionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Picker state
  const [selectedAdId, setSelectedAdId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("purchases");
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  const [hideAnalyzed, setHideAnalyzed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

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

  const rowByAdId = useMemo(() => {
    const m = new Map<string, DeconstructionRow>();
    for (const r of rows) m.set(r.ad_id, r);
    return m;
  }, [rows]);

  const alreadyAnalyzedIds = useMemo(
    () => new Set(rows.map((r) => r.ad_id)),
    [rows]
  );

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

  // Deep-link: auto-trigger if ?deconstruct_ad=ID was passed.
  useEffect(() => {
    if (!initialAdId) return;
    if (ads.length === 0) return;
    setSelectedAdId(initialAdId);
    runAnalyze(initialAdId).finally(() => {
      onAutoAnalyzeHandled?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAdId, ads.length]);

  const accountOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of ads) {
      if (a.account_id && a.account && !m.has(a.account_id)) {
        m.set(a.account_id, a.account);
      }
    }
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ads]);

  const visibleAds = useMemo(() => {
    let list = ads;

    if (storeFilter !== "ALL") {
      list = list.filter((a) => a.account_id === storeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.ad.toLowerCase().includes(q) ||
          a.campaign.toLowerCase().includes(q) ||
          a.adset.toLowerCase().includes(q)
      );
    }
    if (hideAnalyzed) {
      list = list.filter((a) => !alreadyAnalyzedIds.has(a.ad_id));
    }

    // Sort descending by chosen metric. Ads with zero in the sort key go last.
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return bv - av;
    });
  }, [ads, storeFilter, search, hideAnalyzed, sortKey, alreadyAnalyzedIds]);

  // Reset visible count when filters change so the user doesn't have to
  // scroll back up to un-stick "Show more".
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [storeFilter, search, hideAnalyzed, sortKey]);

  const selectedAd = selectedAdId ? adMap.get(selectedAdId) : null;
  const selectedIsAnalyzed = selectedAdId
    ? alreadyAnalyzedIds.has(selectedAdId)
    : false;

  // Ads from past analyses that are NOT in the current view — shown as a
  // smaller historical section so older winners stay reachable.
  const historicalRows = useMemo(() => {
    const currentIds = new Set(ads.map((a) => a.ad_id));
    return rows.filter((r) => !currentIds.has(r.ad_id));
  }, [rows, ads]);

  return (
    <div className="space-y-5">
      {/* Selection / action bar */}
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wand2 size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">
            Pick an ad to analyze
          </h3>
        </div>

        {selectedAd ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-[240px]">
              {selectedAd.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedAd.thumbnail_url}
                  alt=""
                  className="w-12 h-12 rounded border border-gray-700 object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-gray-800 border border-gray-700 flex-shrink-0 flex items-center justify-center">
                  <Video size={16} className="text-gray-600" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm text-white font-medium truncate">
                  {selectedAd.ad}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {selectedAd.account} · 🛒 {selectedAd.purchases} · ROAS{" "}
                  {selectedAd.roas.toFixed(2)} · {money(selectedAd.spend)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedIsAnalyzed && (
                <button
                  onClick={() => {
                    const row = rowByAdId.get(selectedAdId);
                    if (row) setActiveRow(row);
                  }}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Eye size={14} />
                  View analysis
                </button>
              )}
              <button
                onClick={() => runAnalyze(selectedAdId, selectedIsAnalyzed)}
                disabled={analyzing}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {analyzing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : selectedIsAnalyzed ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} />
                )}
                {analyzing
                  ? "Analyzing…"
                  : selectedIsAnalyzed
                    ? "Re-run analysis"
                    : "Analyze"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Click a card below to select an ad. Default sort: highest
            purchases.
          </p>
        )}

        {analyzing && (
          <p className="text-xs text-gray-500 mt-3">
            Downloading video + running Gemini analysis. Takes ~20-60 seconds
            for small ads, up to ~3 minutes for large HD videos. Do not close
            the tab.
          </p>
        )}
        {analyzeError && (
          <div className="mt-3 p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>{analyzeError}</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Store:</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:ring-blue-500 focus:border-blue-500 max-w-[200px]"
          >
            <option value="ALL">All stores</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Sort:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:ring-blue-500 focus:border-blue-500"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]} (high → low)
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={hideAnalyzed}
            onChange={(e) => setHideAnalyzed(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
          />
          Hide already analyzed
        </label>
        <div className="relative ml-auto">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ad / campaign / adset…"
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg pl-8 pr-3 py-1.5 focus:ring-blue-500 focus:border-blue-500 w-56"
          />
        </div>
      </div>

      {/* Ad cards grid */}
      <div>
        <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
          <span>
            {visibleAds.length} ad
            {visibleAds.length === 1 ? "" : "s"}
            {storeFilter !== "ALL" || search || hideAnalyzed
              ? " matching filters"
              : ""}
          </span>
          {alreadyAnalyzedIds.size > 0 && (
            <span>{alreadyAnalyzedIds.size} analyzed</span>
          )}
        </div>

        {visibleAds.length === 0 ? (
          <div className="bg-gray-900/30 border border-gray-700/40 rounded-xl p-10 text-center">
            <Video size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">
              {ads.length === 0
                ? "No ads loaded yet."
                : "No ads match your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleAds.slice(0, visibleCount).map((a) => {
                const isAnalyzed = alreadyAnalyzedIds.has(a.ad_id);
                const isSelected = selectedAdId === a.ad_id;
                return (
                  <button
                    key={a.ad_id}
                    onClick={() => setSelectedAdId(a.ad_id)}
                    className={`text-left bg-gray-900/50 border rounded-xl overflow-hidden transition-all cursor-pointer ${
                      isSelected
                        ? "border-blue-500 ring-2 ring-blue-500/40"
                        : "border-gray-700/50 hover:border-gray-500"
                    }`}
                  >
                    <div className="aspect-video bg-gray-800 relative">
                      {a.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.thumbnail_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video size={28} className="text-gray-600" />
                        </div>
                      )}
                      {isAnalyzed && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-emerald-600/90 text-white text-[10px] font-medium px-2 py-0.5 rounded">
                          <CheckCircle2 size={10} /> Analyzed
                        </span>
                      )}
                      <span className="absolute top-2 left-2 bg-gray-900/80 text-gray-200 text-[10px] px-1.5 py-0.5 rounded">
                        {a.account}
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="text-sm text-white font-medium truncate">
                        {a.ad}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">
                        {a.campaign || "—"}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <MetricBadge
                          label="🛒"
                          value={a.purchases.toString()}
                          color={a.purchases > 0 ? "emerald" : "gray"}
                        />
                        <MetricBadge
                          label="ROAS"
                          value={a.roas.toFixed(2)}
                          color={
                            a.roas >= 1.5
                              ? "emerald"
                              : a.roas >= 0.8
                                ? "yellow"
                                : "red"
                          }
                        />
                        <MetricBadge
                          label=""
                          value={money(a.spend)}
                          color="gray"
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {visibleCount < visibleAds.length && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() =>
                    setVisibleCount((n) => n + LOAD_MORE_STEP)
                  }
                  className="text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg cursor-pointer"
                >
                  Show {Math.min(LOAD_MORE_STEP, visibleAds.length - visibleCount)}{" "}
                  more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Historical analyses (from outside current view) */}
      {historicalRows.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-3">
            From other date ranges ({historicalRows.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {historicalRows.slice(0, 12).map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRow(r)}
                className="text-left bg-gray-900/50 border border-gray-700/50 hover:border-gray-500 rounded-lg overflow-hidden transition-colors cursor-pointer"
              >
                <div className="aspect-video bg-gray-800">
                  {r.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnail_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video size={20} className="text-gray-600" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-200 truncate">
                    {r.ad_id}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {new Date(r.created_at).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {listError && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {listError}
        </div>
      )}

      {loadingList && rows.length === 0 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="animate-spin text-gray-500" size={16} />
        </div>
      )}

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

function MetricBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "emerald" | "yellow" | "red" | "gray";
}) {
  const colors: Record<typeof color, string> = {
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    yellow: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    gray: "bg-gray-700/40 text-gray-300 border-gray-600/40",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] border rounded px-1.5 py-0.5 font-mono ${colors[color]}`}
    >
      {label && <span className="opacity-70">{label}</span>}
      <span className="font-semibold">{value}</span>
    </span>
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
