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
  ExternalLink,
  TrendingUp,
  GitCompareArrows,
  Trash2,
  Sparkles,
} from "lucide-react";
import {
  PromoteToScalingModal,
  type PromoteSubject,
} from "@/components/marketing/promote-to-scaling-modal";
import { deriveStore } from "@/lib/shopify/derive-store";
import { ComparativeReportView } from "@/components/marketing/comparative-report";
import type {
  ComparativeReport,
  AdDeconstruction,
} from "@/lib/ai/compare-types";
import type { DatePreset } from "@/lib/facebook/types";

interface AdBrief {
  ad_id: string;
  ad: string;
  account: string;
  account_id: string;
  campaign: string;
  adset: string;
  spend: number;
  purchases: number;
  cpa: number;
  roas: number;
  thumbnail_url: string | null;
  preview_url: string | null;
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

// Aliases the shared AdDeconstruction (legacy fields required, v2.0 Winning
// DNA fields optional). Rows analyzed before the v2.0 prompt rollout will
// have only the legacy keys, so the modal must degrade gracefully.
type Analysis = AdDeconstruction;

interface Props {
  ads: AdBrief[];
  datePreset: DatePreset;
  initialAdId?: string | null;
  onAutoAnalyzeHandled?: () => void;
}

type SortKey = "purchases" | "spend" | "roas" | "cpa";
type Mode = "single" | "compare";

const INITIAL_VISIBLE = 12;
const LOAD_MORE_STEP = 12;
const COMPARE_MAX = 10;
const COMPARE_MIN = 2;

// For most keys we sort descending (bigger = better). CPP is the exception —
// lower cost per purchase is better, so it sorts ascending.
const SORT_SPECS: Record<
  SortKey,
  { label: string; direction: "desc" | "asc" }
> = {
  purchases: { label: "Purchases (high → low)", direction: "desc" },
  spend: { label: "Spend (high → low)", direction: "desc" },
  roas: { label: "ROAS (high → low)", direction: "desc" },
  cpa: { label: "CPP (low → high)", direction: "asc" },
};

function money(n: number): string {
  if (n >= 1000) return `₱${(n / 1000).toFixed(1)}k`;
  return `₱${Math.round(n)}`;
}


export function DeconstructionPanel({
  ads,
  datePreset,
  initialAdId,
  onAutoAnalyzeHandled,
}: Props) {
  const [rows, setRows] = useState<DeconstructionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [storeNames, setStoreNames] = useState<string[]>([]);
  // ad_id → "in scaling" detection result from /api/marketing/scaling/detect
  const [scalingMap, setScalingMap] = useState<
    Map<
      string,
      {
        in_scaling: boolean;
        scaled_in_store: string | null;
        self_is_scaling: boolean;
      }
    >
  >(new Map());

  // Picker state
  const [selectedAdId, setSelectedAdId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("purchases");
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  const [hideAnalyzed, setHideAnalyzed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeAttempts, setAnalyzeAttempts] = useState<string[]>([]);
  const [showAttempts, setShowAttempts] = useState(false);
  const [activeRow, setActiveRow] = useState<DeconstructionRow | null>(null);

  const [promoteSubject, setPromoteSubject] =
    useState<PromoteSubject | null>(null);
  const [promoteToast, setPromoteToast] = useState<string | null>(null);

  // Compare-mode state
  const [mode, setMode] = useState<Mode>("single");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareProgress, setCompareProgress] = useState<{
    stage: "deconstructing" | "comparing";
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [compareReport, setCompareReport] = useState<{
    report: ComparativeReport;
    inputs_snapshot: unknown;
    store_name: string | null;
  } | null>(null);
  const [comparisons, setComparisons] = useState<
    Array<{
      id: string;
      ad_ids: string[];
      store_name: string | null;
      date_preset: string;
      analysis: ComparativeReport;
      inputs_snapshot: unknown;
      model: string | null;
      created_at: string;
    }>
  >([]);
  const [loadingComparisons, setLoadingComparisons] = useState(false);

  const loadComparisons = useCallback(async () => {
    setLoadingComparisons(true);
    try {
      const res = await fetch("/api/marketing/ai-analytics/comparisons?limit=20");
      if (!res.ok) return;
      const json = (await res.json()) as { rows: typeof comparisons };
      setComparisons(json.rows ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoadingComparisons(false);
    }
  }, []);

  const adMap = useMemo(() => {
    const m = new Map<string, AdBrief>();
    for (const a of ads) m.set(a.ad_id, a);
    return m;
  }, [ads]);

  // Map of fb_ad_id → approved-script info, populated lazily from
  // /api/ai/approved-scripts/by-ads. Drives the "Generated from Script" badge.
  const [scriptByAd, setScriptByAd] = useState<
    Record<
      string,
      { script_id: string; angle_title: string; store_name: string }
    >
  >({});

  useEffect(() => {
    if (ads.length === 0) return;
    const adIds = ads.map((a) => a.ad_id);
    let cancelled = false;
    fetch("/api/ai/approved-scripts/by-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_ids: adIds }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setScriptByAd(json.mapping ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/shopify/stores/names");
        if (!res.ok) return;
        const json = (await res.json()) as { names?: string[] };
        if (cancelled) return;
        setStoreNames(json.names ?? []);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Detection: for every ad currently in view, ask the server which ones
  // already have a matching creative_id live in a scaling campaign.
  // Runs once per {ads} batch and is cached by the server (5 min).
  useEffect(() => {
    let cancelled = false;
    if (ads.length === 0) {
      setScalingMap(new Map());
      return;
    }
    (async () => {
      try {
        const adIds = ads.slice(0, 500).map((a) => a.ad_id);
        const res = await fetch("/api/marketing/scaling/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_ids: adIds }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          results?: Record<
            string,
            {
              in_scaling: boolean;
              scaled_in_store: string | null;
              self_is_scaling: boolean;
            }
          >;
        };
        if (cancelled) return;
        const next = new Map<
          string,
          {
            in_scaling: boolean;
            scaled_in_store: string | null;
            self_is_scaling: boolean;
          }
        >();
        for (const [id, info] of Object.entries(json.results ?? {})) {
          next.set(id, info);
        }
        setScalingMap(next);
      } catch {
        // non-fatal — badges just won't appear
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ads]);

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
      setAnalyzeAttempts([]);
      setShowAttempts(false);
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
          if (Array.isArray(json.attempts)) {
            setAnalyzeAttempts(json.attempts as string[]);
          }
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

  // Reset selection when leaving compare mode
  useEffect(() => {
    if (mode === "single") {
      setSelectedIds(new Set());
      setCompareError(null);
    } else {
      // Refresh history when entering compare mode so freshly-saved
      // analyses from another tab/user appear right away.
      loadComparisons();
    }
  }, [mode, loadComparisons]);

  const toggleSelection = useCallback((adId: string) => {
    setCompareError(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) {
        next.delete(adId);
      } else {
        if (next.size >= COMPARE_MAX) return prev;
        next.add(adId);
      }
      return next;
    });
  }, []);

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

  // Attach a derived store to every ad based on campaign-name matching
  // against the Shopify store list. Ad accounts can carry multiple
  // stores so ad_account ≠ store.
  const adsWithStore = useMemo(() => {
    return ads.map((a) => ({
      ...a,
      store: deriveStore(a.campaign, storeNames) ?? "Unmatched",
    }));
  }, [ads, storeNames]);

  const storeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of adsWithStore) {
      counts.set(a.store, (counts.get(a.store) ?? 0) + 1);
    }
    // Stores that actually appear in current ads, sorted by count desc.
    // "Unmatched" always sinks to the bottom.
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === "Unmatched") return 1;
        if (b.name === "Unmatched") return -1;
        return b.count - a.count;
      });
  }, [adsWithStore]);

  const visibleAds = useMemo(() => {
    let list = adsWithStore;

    if (storeFilter !== "ALL") {
      list = list.filter((a) => a.store === storeFilter);
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

    const direction = SORT_SPECS[sortKey].direction;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      // For "low → high" sorts, ads with 0 in the sort key are usually
      // "no data" (e.g. 0 purchases → no real CPP). Push them to the end
      // so "best CPP" results actually show ads that converted.
      if (direction === "asc") {
        const aEmpty = av <= 0;
        const bEmpty = bv <= 0;
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;
        return av - bv;
      }
      return bv - av;
    });
  }, [
    adsWithStore,
    storeFilter,
    search,
    hideAnalyzed,
    sortKey,
    alreadyAnalyzedIds,
  ]);

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

  const selectedStores = useMemo(() => {
    const s = new Set<string>();
    for (const id of selectedIds) {
      const a = adsWithStore.find((x) => x.ad_id === id);
      if (a && a.store !== "Unmatched") s.add(a.store);
    }
    return [...s];
  }, [selectedIds, adsWithStore]);

  // Run comparative analysis. Two stages:
  //   1. Ensure each selected ad has a video deconstruction (sequential —
  //      Gemini File API doesn't love high parallelism on large videos).
  //   2. POST to /compare which fetches per-day metrics + brand docs +
  //      calls Claude Opus.
  const runCompare = useCallback(
    async (forceRefresh = false) => {
      const ids = [...selectedIds];
      if (ids.length < COMPARE_MIN) {
        setCompareError(
          `Pumili ng ${COMPARE_MIN}-${COMPARE_MAX} ads para mag-compare.`
        );
        return;
      }

      setComparing(true);
      setCompareError(null);
      setCompareReport(null);

      if (selectedStores.length > 1) {
        setCompareError(
          `Mixed stores sa selection (${selectedStores.join(", ")}). Pumili ng ads from one store lang para fully applied yung Avatar/Winning Template docs.`
        );
        setComparing(false);
        return;
      }

      // Stage 1: deconstruct any unanalyzed ad (sequential)
      const needDecon = ids.filter((id) => !alreadyAnalyzedIds.has(id));
      for (let i = 0; i < needDecon.length; i++) {
        const id = needDecon[i];
        const ad = adMap.get(id);
        if (!ad) continue;
        setCompareProgress({
          stage: "deconstructing",
          current: i + 1,
          total: needDecon.length,
          label: ad.ad,
        });
        try {
          const res = await fetch(
            "/api/marketing/ai-analytics/deconstruct",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ad_id: id,
                account_id: ad.account_id,
                trigger_source: "on_demand",
              }),
            }
          );
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(
              (j as { error?: string }).error ||
                `Failed to deconstruct "${ad.ad}" (${res.status})`
            );
          }
        } catch (e) {
          setCompareError(
            e instanceof Error
              ? `${e.message} — tanggalin yung ad sa selection o i-retry.`
              : "Deconstruction failed"
          );
          setCompareProgress(null);
          setComparing(false);
          return;
        }
      }
      if (needDecon.length > 0) await loadList();

      // Stage 2: comparative analysis
      setCompareProgress({
        stage: "comparing",
        current: 0,
        total: 0,
        label: "Running Claude Opus strategic analysis…",
      });
      try {
        const res = await fetch("/api/marketing/ai-analytics/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_ids: ids,
            date_preset: datePreset,
            force_refresh: forceRefresh,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error ||
              `Compare failed (${res.status})`
          );
        }
        const row = (json as {
          row: {
            analysis: ComparativeReport;
            inputs_snapshot: unknown;
            store_name: string | null;
          };
        }).row;
        setCompareReport({
          report: row.analysis,
          inputs_snapshot: row.inputs_snapshot,
          store_name: row.store_name,
        });
        // Refresh history so the new (or re-run) entry appears immediately.
        loadComparisons();
      } catch (e) {
        setCompareError(e instanceof Error ? e.message : "Compare failed");
      } finally {
        setComparing(false);
        setCompareProgress(null);
      }
    },
    [
      selectedIds,
      selectedStores,
      adMap,
      alreadyAnalyzedIds,
      datePreset,
      loadList,
      loadComparisons,
    ]
  );

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMode("single")}
          disabled={comparing}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${
            mode === "single"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-200 cursor-pointer"
          }`}
        >
          <Wand2 size={12} /> Single
        </button>
        <button
          onClick={() => setMode("compare")}
          disabled={comparing || analyzing}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${
            mode === "compare"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-200 cursor-pointer"
          }`}
          title="Pick 2-10 ads to compare side-by-side with Claude Opus"
        >
          <GitCompareArrows size={12} /> Compare & Strategize
        </button>
      </div>

      {/* Selection / action bar */}
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wand2 size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">
            {mode === "single"
              ? "Pick an ad to analyze"
              : `Pick ${COMPARE_MIN}-${COMPARE_MAX} ads to compare (${selectedIds.size} selected)`}
          </h3>
        </div>

        {mode === "compare" ? (
          <CompareActionBar
            selectedCount={selectedIds.size}
            stores={selectedStores}
            comparing={comparing}
            progress={compareProgress}
            error={compareError}
            onRun={() => runCompare(false)}
            onClear={() => setSelectedIds(new Set())}
          />
        ) : (
          <>

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
                  {selectedAd.roas.toFixed(2)} · CPP{" "}
                  {selectedAd.purchases > 0
                    ? `₱${Math.round(selectedAd.cpa)}`
                    : "—"}{" "}
                  · {money(selectedAd.spend)}
                </p>
                {scriptByAd[selectedAdId] && (
                  <a
                    href={`/marketing/ai-generator?view=library&script=${scriptByAd[selectedAdId].script_id}`}
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200"
                    title="Open source script in Approved Library"
                  >
                    <Sparkles size={10} />
                    From script: {scriptByAd[selectedAdId].angle_title}
                  </a>
                )}
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
              {(() => {
                const info = scalingMap.get(selectedAdId);
                const isPromotable =
                  !info?.in_scaling && !info?.self_is_scaling;
                if (!isPromotable) return null;
                return (
                  <button
                    onClick={() => {
                      setPromoteSubject({
                        ad_id: selectedAd.ad_id,
                        ad_name: selectedAd.ad,
                        thumbnail_url: selectedAd.thumbnail_url,
                        campaign_name: selectedAd.campaign,
                      });
                    }}
                    disabled={analyzing}
                    title="Copy this ad into your scaling campaign"
                    className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <TrendingUp size={14} />
                    Promote
                  </button>
                );
              })()}
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
          <div className="mt-3 p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">{analyzeError}</div>
            </div>
            {analyzeAttempts.length > 0 && (
              <div className="mt-2 ml-5">
                <button
                  onClick={() => setShowAttempts((v) => !v)}
                  className="text-[11px] text-red-200 underline cursor-pointer"
                >
                  {showAttempts ? "Hide" : "Show"} debug trail (
                  {analyzeAttempts.length} steps)
                </button>
                {showAttempts && (
                  <pre className="mt-1.5 p-2 bg-gray-900/60 border border-gray-700 rounded text-[10px] text-gray-300 whitespace-pre-wrap font-mono">
                    {analyzeAttempts
                      .map((a, i) => `${i + 1}. ${a}`)
                      .join("\n")}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {/* Compare mode: past analyses history */}
      {mode === "compare" && (
        <ComparisonHistory
          rows={comparisons}
          loading={loadingComparisons}
          onOpen={(row) =>
            setCompareReport({
              report: row.analysis,
              inputs_snapshot: row.inputs_snapshot,
              store_name: row.store_name,
            })
          }
          onRefresh={loadComparisons}
        />
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Store:</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:ring-blue-500 focus:border-blue-500 max-w-[200px]"
            title="Derived from the campaign name — matches your Shopify store list"
          >
            <option value="ALL">All stores</option>
            {storeOptions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.count})
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
            {(Object.keys(SORT_SPECS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_SPECS[k].label}
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
                const isSingleSelected =
                  mode === "single" && selectedAdId === a.ad_id;
                const isCompareSelected =
                  mode === "compare" && selectedIds.has(a.ad_id);
                const isCapHit =
                  mode === "compare" &&
                  !isCompareSelected &&
                  selectedIds.size >= COMPARE_MAX;
                const handleCardClick = () => {
                  if (comparing) return;
                  if (mode === "compare") {
                    if (isCapHit) return;
                    toggleSelection(a.ad_id);
                  } else {
                    setSelectedAdId(a.ad_id);
                  }
                };
                return (
                  <div
                    key={a.ad_id}
                    onClick={handleCardClick}
                    className={`relative text-left bg-gray-900/50 border rounded-xl overflow-hidden transition-all ${
                      isCapHit ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                    } ${
                      isSingleSelected || isCompareSelected
                        ? "border-blue-500 ring-2 ring-blue-500/40"
                        : "border-gray-700/50 hover:border-gray-500"
                    }`}
                  >
                    {mode === "compare" && (
                      <div className="absolute top-2 left-2 z-10">
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isCompareSelected
                              ? "bg-blue-500 border-blue-500"
                              : "bg-gray-900/80 border-gray-500"
                          }`}
                        >
                          {isCompareSelected && (
                            <CheckCircle2 size={12} className="text-white" />
                          )}
                        </div>
                      </div>
                    )}
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
                      <span
                        className={`absolute top-2 ${mode === "compare" ? "left-9" : "left-2"} text-[10px] px-1.5 py-0.5 rounded ${
                          a.store === "Unmatched"
                            ? "bg-gray-700/80 text-gray-400"
                            : "bg-gray-900/80 text-gray-200"
                        }`}
                      >
                        {a.store}
                      </span>
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {(() => {
                          const info = scalingMap.get(a.ad_id);
                          if (info?.self_is_scaling) {
                            return (
                              <span
                                title="This ad itself is inside a scaling campaign"
                                className="inline-flex items-center gap-1 bg-orange-600/90 text-white text-[10px] font-medium px-2 py-0.5 rounded"
                              >
                                <TrendingUp size={10} /> In scaling
                              </span>
                            );
                          }
                          if (info?.in_scaling) {
                            return (
                              <span
                                title={
                                  info.scaled_in_store
                                    ? `Already scaled in ${info.scaled_in_store}`
                                    : "Already scaled"
                                }
                                className="inline-flex items-center gap-1 bg-orange-600/90 text-white text-[10px] font-medium px-2 py-0.5 rounded"
                              >
                                <TrendingUp size={10} /> Scaled
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {isAnalyzed && (
                          <span className="inline-flex items-center gap-1 bg-emerald-600/90 text-white text-[10px] font-medium px-2 py-0.5 rounded">
                            <CheckCircle2 size={10} /> Analyzed
                          </span>
                        )}
                        {a.preview_url && (
                          <a
                            href={a.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open this ad on Facebook"
                            className="inline-flex items-center justify-center w-6 h-6 bg-gray-900/80 hover:bg-gray-800 text-gray-200 rounded"
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-sm text-white font-medium truncate">
                        {a.ad}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">
                        {a.campaign || "—"}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
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
                          label="CPP"
                          value={a.purchases > 0 ? `₱${Math.round(a.cpa)}` : "—"}
                          color={a.purchases === 0 ? "gray" : "gray"}
                        />
                        <MetricBadge
                          label=""
                          value={money(a.spend)}
                          color="gray"
                        />
                      </div>
                    </div>
                  </div>
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

      {promoteSubject && (
        <PromoteToScalingModal
          subject={promoteSubject}
          onClose={() => setPromoteSubject(null)}
          onSuccess={({ status }) => {
            setPromoteSubject(null);
            setPromoteToast(
              status === "ACTIVE"
                ? "Ad copied to scaling campaign (ACTIVE)."
                : "Ad copied to scaling campaign (PAUSED — review in Ads Manager)."
            );
            // Nudge the parent to refresh detection: we invalidate by
            // re-firing the detect effect. The server cache refreshes
            // within 5 minutes; meantime the user already sees the toast.
            setTimeout(() => setPromoteToast(null), 5000);
          }}
        />
      )}

      {compareReport && (
        <ComparativeReportModal
          report={compareReport.report}
          inputsSnapshot={compareReport.inputs_snapshot}
          storeName={compareReport.store_name}
          onClose={() => setCompareReport(null)}
          onRerun={() => runCompare(true)}
          rerunning={comparing}
        />
      )}

      {promoteToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-orange-700/90 border border-orange-500 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm">
          {promoteToast}
        </div>
      )}
    </div>
  );
}

function CompareActionBar({
  selectedCount,
  stores,
  comparing,
  progress,
  error,
  onRun,
  onClear,
}: {
  selectedCount: number;
  stores: string[];
  comparing: boolean;
  progress: {
    stage: "deconstructing" | "comparing";
    current: number;
    total: number;
    label: string;
  } | null;
  error: string | null;
  onRun: () => void;
  onClear: () => void;
}) {
  const canRun = selectedCount >= COMPARE_MIN && !comparing;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-2xl font-bold text-white">{selectedCount}</span>
          <div className="text-xs text-gray-400 leading-tight">
            <p>
              of {COMPARE_MAX} max
              {selectedCount < COMPARE_MIN && ` · need ≥${COMPARE_MIN}`}
            </p>
            <p>
              Store:{" "}
              {stores.length === 0 ? (
                <span className="text-gray-500">—</span>
              ) : stores.length === 1 ? (
                <span className="text-emerald-400">{stores[0]}</span>
              ) : (
                <span className="text-red-400">
                  Mixed ({stores.join(", ")})
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && !comparing && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 size={14} />
              Clear
            </button>
          )}
          <button
            onClick={onRun}
            disabled={!canRun}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Deconstruct any unanalyzed videos, then run Claude Opus comparative analysis"
          >
            {comparing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GitCompareArrows size={14} />
            )}
            {comparing ? "Working…" : "Analyze & Compare"}
          </button>
        </div>
      </div>

      {progress && (
        <div className="p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg text-xs text-blue-200">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            <span className="font-semibold">
              {progress.stage === "deconstructing"
                ? `Deconstructing video ${progress.current} of ${progress.total}`
                : "Strategic analysis"}
            </span>
          </div>
          <p className="text-blue-300/80 truncate ml-5">{progress.label}</p>
          {progress.stage === "deconstructing" && (
            <p className="text-[10px] text-blue-400/60 ml-5 mt-1">
              ~30-90s per video. Do not close the tab.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        </div>
      )}

      {selectedCount === 0 && !comparing && !error && (
        <p className="text-xs text-gray-500">
          Click cards below to add ads to the comparison. Pick from one store
          for best results — yung store na yon ang i-i-inject sa Avatar +
          Winning Template docs.
        </p>
      )}
    </div>
  );
}

function ComparisonHistory({
  rows,
  loading,
  onOpen,
  onRefresh,
}: {
  rows: Array<{
    id: string;
    ad_ids: string[];
    store_name: string | null;
    date_preset: string;
    analysis: ComparativeReport;
    inputs_snapshot: unknown;
    model: string | null;
    created_at: string;
  }>;
  loading: boolean;
  onOpen: (row: {
    analysis: ComparativeReport;
    inputs_snapshot: unknown;
    store_name: string | null;
  }) => void;
  onRefresh: () => void;
}) {
  if (rows.length === 0 && !loading) {
    return (
      <div className="bg-gray-900/30 border border-dashed border-gray-700/50 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-500">
          Wala pang comparative analyses na na-save. Mag-run ng &quot;Analyze
          &amp; Compare&quot; para mag-build ng history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Past Analyses ({rows.length})
        </h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw
            size={10}
            className={loading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((r) => {
          const snap = r.inputs_snapshot as
            | {
                ads?: Array<{
                  ad_id: string;
                  ad_name: string;
                  thumbnail_url: string | null;
                  consistency?: { tier: string };
                }>;
              }
            | null;
          const ads = snap?.ads ?? [];
          const winners = ads.filter(
            (a) => a.consistency?.tier === "stable_winner"
          ).length;
          const thumbs = ads.slice(0, 4);
          const remaining = ads.length - thumbs.length;

          return (
            <button
              key={r.id}
              onClick={() =>
                onOpen({
                  analysis: r.analysis,
                  inputs_snapshot: r.inputs_snapshot,
                  store_name: r.store_name,
                })
              }
              className="text-left bg-gray-900/50 border border-gray-700/50 hover:border-emerald-600/50 rounded-lg p-3 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">
                    {r.store_name ?? "Unknown store"} · {ads.length} ads
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {r.date_preset} ·{" "}
                    {new Date(r.created_at).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {winners > 0 && (
                      <span className="ml-1 text-emerald-400">
                        · {winners} winner{winners === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>
                <Eye
                  size={12}
                  className="text-gray-500 flex-shrink-0 mt-0.5"
                />
              </div>

              {thumbs.length > 0 && (
                <div className="flex items-center gap-1 mb-2">
                  {thumbs.map((a) =>
                    a.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={a.ad_id}
                        src={a.thumbnail_url}
                        alt=""
                        className="w-9 h-9 rounded border border-gray-700 object-cover flex-shrink-0"
                      />
                    ) : (
                      <div
                        key={a.ad_id}
                        className="w-9 h-9 rounded bg-gray-800 border border-gray-700 flex-shrink-0"
                      />
                    )
                  )}
                  {remaining > 0 && (
                    <span className="text-[10px] text-gray-500 ml-1">
                      +{remaining}
                    </span>
                  )}
                </div>
              )}

              <p className="text-[11px] text-gray-300 line-clamp-2 leading-relaxed">
                {r.analysis.summary || "No summary."}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComparativeReportModal({
  report,
  inputsSnapshot,
  storeName,
  onClose,
  onRerun,
  rerunning,
}: {
  report: ComparativeReport;
  inputsSnapshot: unknown;
  storeName: string | null;
  onClose: () => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">
              Comparative Analysis Report
            </h2>
            {storeName && (
              <p className="text-xs text-gray-400 mt-0.5">Store: {storeName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRerun}
              disabled={rerunning}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40 cursor-pointer px-2 py-1"
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
              className="text-gray-400 hover:text-white p-1 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">
          <ComparativeReportView
            report={report}
            inputsSnapshot={
              inputsSnapshot as Parameters<typeof ComparativeReportView>[0]["inputsSnapshot"]
            }
            storeName={storeName}
          />
        </div>
      </div>
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
          <WinningDnaSections a={a} />

          {/* — Legacy descriptive layer — */}
          <Section title="Visual style">
            <p className="text-sm text-gray-200">{a.visual_style}</p>
          </Section>

          <Section title="Tone">
            <p className="text-sm text-gray-200">{a.tone}</p>
          </Section>

          <Section title="CTA delivery">
            <p className="text-sm text-gray-200">{a.cta}</p>
          </Section>

          {!a.beat_map && (
            <Section title="Hook (first 3 seconds)">
              <p className="text-xs text-gray-500 mb-1 font-mono">
                {a.hook.timestamp}
              </p>
              <p className="text-sm text-gray-200">{a.hook.description}</p>
            </Section>
          )}

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
          <div className="flex flex-wrap gap-2 items-center">
            {/* Expand-from-Winner — only meaningful when the analysis has v2
                fields (viral_mechanism). Legacy rows would dilute the
                generator's context, so they're disabled and prompt re-run. */}
            <a
              href={`/marketing/ai-generator?tool=scripts&winner_analysis_id=${row.id}`}
              aria-disabled={!a.viral_mechanism}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                a.viral_mechanism
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-gray-800 text-gray-500 pointer-events-none cursor-not-allowed"
              }`}
              title={
                a.viral_mechanism
                  ? "Open Script Creator pre-loaded with this winner's DNA"
                  : "Re-run with v2.0 prompt to enable expansion"
              }
            >
              <Sparkles size={12} />
              Expand → Scripts
            </a>
            <a
              href={`/marketing/ai-generator?tool=angles&winner_analysis_id=${row.id}`}
              aria-disabled={!a.viral_mechanism}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                a.viral_mechanism
                  ? "bg-emerald-600/30 hover:bg-emerald-500/40 text-emerald-200 border border-emerald-700/50"
                  : "bg-gray-800 text-gray-500 pointer-events-none cursor-not-allowed border border-gray-700"
              }`}
              title={
                a.viral_mechanism
                  ? "Open Angle Generator pre-loaded with this winner's DNA"
                  : "Re-run with v2.0 prompt to enable expansion"
              }
            >
              <Sparkles size={12} />
              Expand → Angles
            </a>
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

// Renders the v2.0 Winning DNA Report sections. If the analysis row was
// produced before the v2.0 prompt rollout (no `fingerprint`), emits a
// legacy-row notice instead so the user knows why the new sections are
// missing — and still falls through to the legacy descriptive layer below.
function WinningDnaSections({ a }: { a: Analysis }) {
  if (!a.fingerprint) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 text-xs text-yellow-200">
        This row was analyzed before the Winning DNA v2.0 prompt rolled out
        (2026-04-28). Click <strong>Re-run</strong> to regenerate with the new
        structural extraction (Fingerprint, Classification, Viral Mechanism,
        Format Compatibility, Angle Variations).
      </div>
    );
  }

  const { classification, hook_anatomy, beat_map, uvp, open_loop } = a;

  return (
    <div className="space-y-5 pb-2 border-b border-gray-700/50">
      <Section title="Fingerprint">
        <p className="text-sm text-gray-200 leading-relaxed">{a.fingerprint}</p>
      </Section>

      {classification && (
        <Section title="Classification">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-gray-800/40 border border-gray-700/40 rounded-lg p-3">
            <KvRow k="Avatar" v={classification.avatar} />
            <KvRow k="Angle" v={classification.angle} />
            <KvRow k="Awareness" v={classification.awareness_level} mono />
            <KvRow k="Funnel Stage" v={classification.funnel_stage} mono />
            <KvRow k="Hook Framework" v={classification.hook_framework} />
            <KvRow k="Strategic Format" v={classification.strategic_format} />
            <KvRow
              k="Video Format"
              v={classification.video_format}
              colSpan2
            />
          </div>
        </Section>
      )}

      {a.viral_mechanism && (
        <Section title="Viral Mechanism">
          <p className="text-sm text-emerald-200 leading-relaxed bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3">
            {a.viral_mechanism}
          </p>
        </Section>
      )}

      {hook_anatomy && (
        <Section title="Hook Anatomy">
          <div className="space-y-1.5 text-sm">
            <KvRow k="Attention Trigger" v={hook_anatomy.attention_trigger} />
            <KvRow k="Information Gap" v={hook_anatomy.information_gap} />
            <KvRow k="Implied Promise" v={hook_anatomy.implied_promise} />
          </div>
        </Section>
      )}

      {beat_map && (
        <Section title="Beat Map">
          <div className="space-y-2">
            <BeatRow label="Hook" range={beat_map.hook.range} content={beat_map.hook.content} />
            <BeatRow
              label="Body Open"
              range={beat_map.body_open.range}
              content={beat_map.body_open.content}
            />
            <BeatRow
              label="Body Core"
              range={beat_map.body_core.range}
              content={beat_map.body_core.content}
            />
            <BeatRow
              label="Close / CTA"
              range={beat_map.close.range}
              content={beat_map.close.content}
            />
            <div className="text-[11px] text-gray-500 pt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Cut frequency: <span className="text-gray-300">{beat_map.cut_frequency}</span></span>
              {beat_map.text_overlay_timestamps.length > 0 && (
                <span>
                  Text overlays at:{" "}
                  <span className="text-gray-300 font-mono">
                    {beat_map.text_overlay_timestamps.join(", ")}
                  </span>
                </span>
              )}
            </div>
          </div>
        </Section>
      )}

      {uvp && (
        <Section title="UVP Extraction">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-gray-800/40 border border-gray-700/40 rounded-lg p-3">
            <KvRow k="Core Promise" v={uvp.core_promise} colSpan2 />
            <KvRow k="Mechanism" v={uvp.mechanism} />
            <KvRow k="Differentiator" v={uvp.differentiator} />
            <KvRow k="Proof Element" v={uvp.proof_element} />
            <KvRow k="Cost / Effort" v={uvp.cost_effort_frame} />
          </div>
        </Section>
      )}

      {open_loop && (
        <Section title="Open Loop Trace">
          <div className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <span className="text-blue-400 font-mono text-xs pt-0.5 w-16 flex-shrink-0">
                {open_loop.opened_at}
              </span>
              <span className="text-gray-200">
                <span className="text-gray-500">Opens: </span>
                {open_loop.opened_content}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-400 font-mono text-xs pt-0.5 w-16 flex-shrink-0">
                {open_loop.closed_at}
              </span>
              <span className="text-gray-200">
                <span className="text-gray-500">Closes: </span>
                {open_loop.closed_content}
              </span>
            </div>
            <div className="text-[11px] text-gray-500">
              Closure quality:{" "}
              <span
                className={
                  open_loop.closure_quality === "earned"
                    ? "text-emerald-300"
                    : open_loop.closure_quality === "partial"
                      ? "text-yellow-300"
                      : "text-red-300"
                }
              >
                {open_loop.closure_quality}
              </span>
            </div>
          </div>
        </Section>
      )}

      {a.format_compatibility && a.format_compatibility.length > 0 && (
        <Section title="Format Compatibility (expansion candidates)">
          <ol className="space-y-2 list-decimal list-inside">
            {a.format_compatibility.map((fc, i) => (
              <li key={i} className="text-sm text-gray-200">
                <span className="font-mono text-xs text-blue-400">
                  {fc.format_number}
                </span>{" "}
                <span className="font-medium">{fc.format_name}</span>
                <div className="ml-5 mt-1 text-xs text-gray-400 space-y-0.5">
                  <p>
                    <span className="text-gray-500">Fit: </span>
                    {fc.fit_reason}
                  </p>
                  <p>
                    <span className="text-gray-500">Script shift: </span>
                    {fc.script_shift}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {a.angle_variations && a.angle_variations.length > 0 && (
        <Section title="Angle Variations">
          <ol className="space-y-2 list-decimal list-inside">
            {a.angle_variations.map((av, i) => (
              <li key={i} className="text-sm text-gray-200">
                <p>{av.angle}</p>
                <div className="ml-5 mt-1 text-xs text-gray-400 space-y-0.5">
                  <p>
                    <span className="text-gray-500">Hook: </span>
                    {av.hook_framework}
                  </p>
                  <p>
                    <span className="text-gray-500">Formats: </span>
                    <span className="font-mono">{av.formats}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {a.cross_check_findings && a.cross_check_findings.length > 0 && (
        <Section title="Cross-check findings">
          <ul className="space-y-1 list-disc list-inside">
            {a.cross_check_findings.map((f, i) => (
              <li key={i} className="text-sm text-yellow-200">
                {f}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function KvRow({
  k,
  v,
  mono = false,
  colSpan2 = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
  colSpan2?: boolean;
}) {
  return (
    <div className={colSpan2 ? "sm:col-span-2" : ""}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{k}</p>
      <p className={`text-sm text-gray-200 ${mono ? "font-mono" : ""}`}>{v}</p>
    </div>
  );
}

function BeatRow({
  label,
  range,
  content,
}: {
  label: string;
  range: string;
  content: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-24">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          {label}
        </p>
        <p className="text-blue-400 font-mono text-xs">{range}</p>
      </div>
      <p className="text-sm text-gray-200 flex-1">{content}</p>
    </div>
  );
}
