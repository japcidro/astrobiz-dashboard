"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RefreshCw,
  Search,
  Trophy,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Wand2,
  ExternalLink,
  GitCompareArrows,
  Play,
  Pause,
} from "lucide-react";
import {
  DeconstructionDetailModal,
  ComparativeReportModal,
  type DeconstructionRow,
} from "@/components/marketing/deconstruction-panel";
import { WinnersLogModal } from "@/components/marketing/winners-log-modal";
import { deriveStore } from "@/lib/shopify/derive-store";
import type { ComparativeReport } from "@/lib/ai/compare-types";
import type { DatePreset } from "@/lib/facebook/types";

// ─── Types ───

interface AdRow {
  ad_id: string;
  ad: string;
  account: string;
  account_id: string;
  campaign: string;
  adset: string;
  status: string;
  spend: number;
  purchases: number;
  cpa: number;
  roas: number;
  impressions: number;
  ctr: number;
  thumbnail_url: string | null;
  preview_url: string | null;
}

interface Enrichments {
  analyses: Record<string, { has_analysis: true; has_v2: boolean }>;
  scaling: Record<
    string,
    { self_is_scaling: boolean; in_scaling: boolean }
  >;
  winner_pool: Record<
    string,
    { tagged_at: string; tagged_by_name: string | null }
  >;
  attributions: Record<
    string,
    {
      source: "autopilot" | "manual";
      reason: string | null;
      actor_name: string | null;
      at: string;
    }
  >;
  winners: Record<
    string,
    {
      approved_script_id: string;
      label: string;
      store_name: string;
      performance_status: string;
      roas: number | null;
      cpp: number | null;
      purchases: number | null;
      max_consecutive: number | null;
      linked_at: string;
    }
  >;
}

type Attribution = Enrichments["attributions"][string];

type Tab = "all" | "winners";
type CampaignType = "testing" | "scaling" | "all";
type SortKey = "spend" | "purchases" | "roas" | "cpa" | "linked_at";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 14 Days", value: "last_14d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
];

const COMPARE_MIN = 2;
const COMPARE_MAX = 10;

// FB ad-entity statuses the user can actually flip from the dashboard.
// Mirrors the gate used in the Ad Performance page so behavior is
// consistent. Parent-paused ("CAMPAIGN PAUSED" / "ADSET PAUSED"),
// DELETED, ARCHIVED, UNKNOWN, and "ACCOUNT *" are not flippable from
// an ad-level toggle.
const TOGGLEABLE_STATUSES = new Set([
  "ACTIVE",
  "PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "DISAPPROVED",
]);

function statusBadgeStyle(status: string): {
  label: string;
  className: string;
} {
  const s = status || "UNKNOWN";
  if (s === "ACTIVE") {
    return {
      label: "Active",
      className: "bg-green-900/40 text-green-300 border-green-700/50",
    };
  }
  if (s === "PAUSED") {
    return {
      label: "Paused",
      className: "bg-gray-800 text-gray-400 border-gray-700",
    };
  }
  if (s.includes("DISAPPROVED")) {
    return {
      label: "Rejected",
      className: "bg-red-900/40 text-red-300 border-red-700/50",
    };
  }
  if (s === "WITH_ISSUES" || s === "PENDING_BILLING_INFO") {
    return {
      label: s === "WITH_ISSUES" ? "Issues" : "Billing",
      className: "bg-amber-900/40 text-amber-300 border-amber-700/50",
    };
  }
  if (s === "PENDING_REVIEW" || s === "IN_PROCESS" || s === "PREAPPROVED") {
    return {
      label: s === "IN_PROCESS" ? "Processing" : "Review",
      className: "bg-blue-900/40 text-blue-300 border-blue-700/50",
    };
  }
  if (s.startsWith("CAMPAIGN ")) {
    return {
      label: "Camp. " + s.slice(9).toLowerCase(),
      className: "bg-orange-900/40 text-orange-300 border-orange-700/50",
    };
  }
  if (s.startsWith("ADSET ")) {
    return {
      label: "Adset " + s.slice(6).toLowerCase(),
      className: "bg-orange-900/40 text-orange-300 border-orange-700/50",
    };
  }
  if (s.startsWith("ACCOUNT ")) {
    return {
      label: "Account " + s.slice(8).toLowerCase(),
      className: "bg-red-900/30 text-red-300 border-red-700/40",
    };
  }
  return {
    label: s.toLowerCase(),
    className: "bg-gray-800 text-gray-500 border-gray-700",
  };
}

// Tab visibility:
//   * "winners" tab → only ads in the curated Winners Pool.
//   * "all" tab → ads with spend, EXCLUDING anything already in the
//     Winners Pool (so they don't show in both places).
function isVisible(row: EnrichedRow, tab: Tab): boolean {
  if (tab === "winners") return row.in_winner_pool;
  if (row.in_winner_pool) return false;
  return row.spend > 0;
}

interface EnrichedRow extends AdRow {
  store: string | null;
  analysis: { has_analysis: true; has_v2: boolean } | null;
  in_winner_pool: boolean;
  pool_tagged_at: string | null;
  pool_tagged_by: string | null;
}

// ─── Page ───

export default function CreativesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "all";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [datePreset, setDatePreset] = useState<DatePreset>("last_14d");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  // Default to testing campaigns — the user's main use case for this page
  // is finding new winners, which happen in testing not scaling.
  const [campaignFilter, setCampaignFilter] = useState<CampaignType>("testing");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [ads, setAds] = useState<AdRow[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [storeNames, setStoreNames] = useState<string[]>([]);
  const [enrichments, setEnrichments] = useState<Enrichments>({
    analyses: {},
    scaling: {},
    winner_pool: {},
    attributions: {},
    winners: {},
  });

  // Ad currently mid-tag/untag (Winners Pool toggle)
  const [taggingWinnerId, setTaggingWinnerId] = useState<string | null>(null);
  // Show the Log generator modal
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ads currently mid-toggle. Used to show a spinner per row + disable
  // the button until the FB call resolves.
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Selection (used only in Winners tab for Compare)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal state
  const [activeRow, setActiveRow] = useState<DeconstructionRow | null>(null);
  const [modalAdName, setModalAdName] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [compareReport, setCompareReport] = useState<{
    report: ComparativeReport;
    inputs_snapshot: unknown;
    store_name: string | null;
  } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareProgress, setCompareProgress] = useState<{
    stage: "deconstructing" | "comparing";
    current: number;
    total: number;
    label: string;
  } | null>(null);

  // ─── Data loaders ───

  const loadStoreNames = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify/stores/names");
      if (!res.ok) return;
      const json = (await res.json()) as { names?: string[] };
      setStoreNames(json.names ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadEnrichments = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/creatives/enrichments");
      if (!res.ok) return;
      const json = (await res.json()) as Enrichments;
      setEnrichments(json);
    } catch {
      /* non-fatal */
    }
  }, []);

  // /api/facebook/all-ads intentionally returns thumbnail_url: null for
  // every ad (creative joins would time out the main payload). After the
  // ads load, fire a background fetch against /api/facebook/ad-creatives
  // which batches in 50s + parallelizes — merge the thumbnails back into
  // the row state when it returns. Non-fatal if it fails.
  const loadThumbnails = useCallback(async (rows: AdRow[]) => {
    const ids = rows.map((r) => r.ad_id).filter(Boolean);
    if (ids.length === 0) return;
    try {
      const res = await fetch(
        `/api/facebook/ad-creatives?ids=${ids.join(",")}`
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        creatives: Record<
          string,
          { preview_url: string | null; thumbnail_url: string | null }
        >;
      };
      const creatives = json.creatives ?? {};
      setAds((prev) =>
        prev.map((a) => {
          const c = creatives[a.ad_id];
          if (!c) return a;
          return {
            ...a,
            thumbnail_url: c.thumbnail_url ?? a.thumbnail_url,
            preview_url: c.preview_url ?? a.preview_url,
          };
        })
      );
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadAds = useCallback(
    async (forceRefresh: boolean) => {
      const setter = forceRefresh ? setRefreshing : setLoading;
      setter(true);
      setError(null);
      setThrottled(false);
      try {
        const url = `/api/facebook/all-ads?date_preset=${datePreset}&account=${accountFilter}${forceRefresh ? "&refresh=1" : ""}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load ads");
        const data = (json.data as AdRow[]) ?? [];
        setAds(data);
        setAccounts((json.accounts as { id: string; name: string }[]) ?? []);
        setRefreshedAt((json.refreshed_at as string) ?? null);
        if (json.throttled_refresh) setThrottled(true);
        // Background thumbnail merge — doesn't block the table render.
        void loadThumbnails(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load ads");
      } finally {
        setter(false);
      }
    },
    [datePreset, accountFilter, loadThumbnails]
  );

  // Toggle an ad in/out of the Winners Pool. The pool is the bucket of
  // ads the next generated Log document will analyze (winners AND
  // notable losers — survivorship bias otherwise per the spec).
  const toggleWinnerTag = useCallback(
    async (adId: string, currentlyTagged: boolean) => {
      if (!adId || taggingWinnerId) return;
      setTaggingWinnerId(adId);
      setError(null);
      try {
        if (currentlyTagged) {
          const res = await fetch(
            `/api/marketing/winners-pool/${encodeURIComponent(adId)}`,
            { method: "DELETE" }
          );
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Untag failed");
        } else {
          const ad = ads.find((a) => a.ad_id === adId);
          const store = ad?.campaign
            ? deriveStore(ad.campaign, storeNames)
            : null;
          const res = await fetch("/api/marketing/winners-pool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ad_id: adId, store_name: store }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Tag failed");
        }
        await loadEnrichments();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Winners Pool toggle failed");
      } finally {
        setTaggingWinnerId(null);
      }
    },
    [ads, storeNames, taggingWinnerId, loadEnrichments]
  );

  // Flip an ad's effective_status via /api/facebook/manage. Optimistic —
  // patches local state immediately, rolls back on FB error. Costs 1 FB
  // API call per click; well under the 200/hour rate window.
  const toggleAdStatus = useCallback(
    async (adId: string, currentStatus: string) => {
      if (togglingIds.has(adId)) return;
      const newStatus =
        currentStatus === "PAUSED" || currentStatus.includes("DISAPPROVED")
          ? "ACTIVE"
          : "PAUSED";
      setTogglingIds((prev) => new Set(prev).add(adId));
      setToggleError(null);

      // Optimistic update
      const previousStatus = currentStatus;
      setAds((prev) =>
        prev.map((a) => (a.ad_id === adId ? { ...a, status: newStatus } : a))
      );

      try {
        const res = await fetch("/api/facebook/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "toggle_status",
            entity_id: adId,
            new_status: newStatus,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Toggle failed");
        }
      } catch (e) {
        // Roll back the optimistic update
        setAds((prev) =>
          prev.map((a) =>
            a.ad_id === adId ? { ...a, status: previousStatus } : a
          )
        );
        setToggleError(e instanceof Error ? e.message : "Toggle failed");
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(adId);
          return next;
        });
      }
    },
    [togglingIds]
  );

  // Initial loads
  useEffect(() => {
    loadStoreNames();
    loadEnrichments();
  }, [loadStoreNames, loadEnrichments]);

  useEffect(() => {
    loadAds(false);
  }, [loadAds]);

  const deepLinkHandled = useRef(false);

  // Reset selection when changing tabs
  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab]);

  // Sync tab to URL so deep-links work
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "winners") {
      url.searchParams.set("tab", "winners");
    } else {
      url.searchParams.delete("tab");
    }
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [tab, router]);

  // ─── Derived rows ───

  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    const rows: EnrichedRow[] = ads.map((a) => {
      const pool = enrichments.winner_pool[a.ad_id];
      return {
        ...a,
        store: deriveStore(a.campaign, storeNames),
        analysis: enrichments.analyses[a.ad_id] ?? null,
        in_winner_pool: !!pool,
        pool_tagged_at: pool?.tagged_at ?? null,
        pool_tagged_by: pool?.tagged_by_name ?? null,
      };
    });

    // Ghost rows: winner-pool ads that don't appear in the current FB
    // payload (paused, outside the date window, etc.) — surface them on
    // the Winners tab anyway so the user sees their full pool.
    const knownAdIds = new Set(rows.map((r) => r.ad_id));
    for (const [adId, pool] of Object.entries(enrichments.winner_pool)) {
      if (knownAdIds.has(adId)) continue;
      rows.push({
        ad_id: adId,
        ad: adId, // no FB name available
        account: "—",
        account_id: "",
        campaign: "",
        adset: "",
        status: "PAUSED",
        spend: 0,
        purchases: 0,
        cpa: 0,
        roas: 0,
        impressions: 0,
        ctr: 0,
        thumbnail_url: null,
        preview_url: null,
        store: null,
        analysis: enrichments.analyses[adId] ?? null,
        in_winner_pool: true,
        pool_tagged_at: pool.tagged_at,
        pool_tagged_by: pool.tagged_by_name,
      });
    }

    return rows;
  }, [ads, storeNames, enrichments]);

  const filteredRows = useMemo(() => {
    let rows = enrichedRows.filter((r) => isVisible(r, tab));
    if (storeFilter !== "ALL") {
      rows = rows.filter((r) => r.store === storeFilter);
    }
    if (campaignFilter !== "all" && tab !== "winners") {
      // tab=winners ignores campaign filter — winners stay visible regardless
      // of where they're running now.
      //
      // We filter on `self_is_scaling` (the ad ITSELF lives in a scaling
      // campaign), NOT `in_scaling` (a testing ad whose creative was scaled
      // — those are testing ads we want to keep visible). Ads not in the
      // cache at all default to testing.
      rows = rows.filter((r) => {
        const isScalingAd = enrichments.scaling[r.ad_id]?.self_is_scaling ?? false;
        return campaignFilter === "scaling" ? isScalingAd : !isScalingAd;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.ad.toLowerCase().includes(q) ||
          r.campaign.toLowerCase().includes(q)
      );
    }

    rows = [...rows].sort((a, b) => {
      let av = 0;
      let bv = 0;
      switch (sortKey) {
        case "spend":
          av = a.spend;
          bv = b.spend;
          break;
        case "purchases":
          av = a.purchases;
          bv = b.purchases;
          break;
        case "roas":
          av = a.roas;
          bv = b.roas;
          break;
        case "cpa":
          // CPP=0 means "no purchases" — push to bottom on asc sort
          av = a.cpa || Number.MAX_SAFE_INTEGER;
          bv = b.cpa || Number.MAX_SAFE_INTEGER;
          break;
        case "linked_at":
          av = a.pool_tagged_at ? Date.parse(a.pool_tagged_at) : 0;
          bv = b.pool_tagged_at ? Date.parse(b.pool_tagged_at) : 0;
          break;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return rows;
  }, [
    enrichedRows,
    tab,
    storeFilter,
    campaignFilter,
    enrichments.scaling,
    search,
    sortKey,
    sortDir,
  ]);

  const counts = useMemo(() => {
    const all = enrichedRows.filter((r) => r.spend > 0 && !r.in_winner_pool).length;
    const winners = enrichedRows.filter((r) => r.in_winner_pool).length;
    return { all, winners };
  }, [enrichedRows]);

  // ─── Row click → modal ───

  const openRow = useCallback(
    async (row: EnrichedRow) => {
      setAnalyzeError(null);
      setModalAdName(row.ad);

      // If already analyzed, fetch the single row by ad_id. The endpoint
      // returns { row } (singular) for that mode, not the list shape.
      if (row.analysis) {
        try {
          const res = await fetch(
            `/api/marketing/ai-analytics/deconstructions?ad_id=${encodeURIComponent(row.ad_id)}`
          );
          const json = (await res.json()) as { row: DeconstructionRow | null };
          if (json.row) setActiveRow(json.row);
          else setAnalyzeError("Couldn't load deconstruction.");
        } catch {
          setAnalyzeError("Couldn't load deconstruction.");
        }
        return;
      }

      // Not analyzed — kick off deconstruction inline. The on-demand endpoint
      // returns the freshly-saved row in the response.
      if (!row.account_id) {
        setAnalyzeError("Can't analyze external winners without a live ad account context.");
        return;
      }
      setAnalyzingId(row.ad_id);
      try {
        const res = await fetch("/api/marketing/ai-analytics/deconstruct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_id: row.ad_id,
            account_id: row.account_id,
            trigger_source: "on_demand",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Analyze failed (${res.status})`);
        }
        if (json.row) setActiveRow(json.row as DeconstructionRow);
        // Refresh enrichments so the table flips its "Analyzed" indicator.
        loadEnrichments();
      } catch (e) {
        setAnalyzeError(e instanceof Error ? e.message : "Analyze failed");
      } finally {
        setAnalyzingId(null);
      }
    },
    [loadEnrichments]
  );

  // Wired onRerun for the modal — re-runs deconstruction on the same ad.
  const rerunActive = useCallback(async () => {
    if (!activeRow) return;
    setAnalyzingId(activeRow.ad_id);
    try {
      const res = await fetch("/api/marketing/ai-analytics/deconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_id: activeRow.ad_id,
          account_id: activeRow.account_id,
          force_refresh: true,
          trigger_source: "on_demand",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Re-run failed");
      if (json.row) setActiveRow(json.row as DeconstructionRow);
      loadEnrichments();
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setAnalyzingId(null);
    }
  }, [activeRow, loadEnrichments]);

  // Deep-link: ?ad_id=X auto-opens that row's modal once the table is ready.
  // Used by the redirect from /marketing/ai-analytics?deconstruct_ad=X and
  // by cron alert action_urls.
  const deepLinkAdId = searchParams.get("ad_id");
  useEffect(() => {
    if (!deepLinkAdId || deepLinkHandled.current) return;
    if (loading) return;
    const row = enrichedRows.find((r) => r.ad_id === deepLinkAdId);
    if (row) {
      deepLinkHandled.current = true;
      // Strip the param so refresh / future tab switches don't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete("ad_id");
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
      // Defer one tick so the table renders before the modal opens
      setTimeout(() => {
        openRow(row);
      }, 0);
    }
  }, [deepLinkAdId, loading, enrichedRows, router, openRow]);

  // ─── Compare flow (Winners tab only) ───

  const selectedRows = useMemo(
    () => filteredRows.filter((r) => selectedIds.has(r.ad_id)),
    [filteredRows, selectedIds]
  );
  const selectedStores = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.store).filter(Boolean))),
    [selectedRows]
  );
  const canCompare =
    selectedIds.size >= COMPARE_MIN &&
    selectedIds.size <= COMPARE_MAX &&
    !comparing;

  const runCompare = useCallback(
    async (forceRefresh = false) => {
      const ids = Array.from(selectedIds);
      if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) {
        setCompareError(
          `Select ${COMPARE_MIN}-${COMPARE_MAX} winners para mag-compare.`
        );
        return;
      }
      if (selectedStores.length > 1) {
        setCompareError(
          `Mixed stores (${selectedStores.join(", ")}). Compare must be one store.`
        );
        return;
      }
      setComparing(true);
      setCompareError(null);
      setCompareReport(null);

      // Stage 1: deconstruct any unanalyzed selections (winners are usually
      // analyzed, but this stays defensive in case a winner was added before
      // its analysis finished — shouldn't happen with the current button
      // gating but covers external-import edge cases).
      const needAnalyze = ids.filter((id) => !enrichments.analyses[id]);
      for (let i = 0; i < needAnalyze.length; i++) {
        const id = needAnalyze[i];
        const row = filteredRows.find((r) => r.ad_id === id);
        if (!row || !row.account_id) continue;
        setCompareProgress({
          stage: "deconstructing",
          current: i + 1,
          total: needAnalyze.length,
          label: row.ad,
        });
        try {
          const r = await fetch("/api/marketing/ai-analytics/deconstruct", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ad_id: id,
              account_id: row.account_id,
              trigger_source: "on_demand",
            }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error((j as { error?: string }).error || `Failed`);
          }
        } catch (e) {
          setCompareError(
            e instanceof Error ? e.message : "Deconstruction failed"
          );
          setCompareProgress(null);
          setComparing(false);
          return;
        }
      }
      if (needAnalyze.length > 0) await loadEnrichments();

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
            (json as { error?: string }).error || `Compare failed (${res.status})`
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
      filteredRows,
      enrichments.analyses,
      datePreset,
      loadEnrichments,
    ]
  );

  // ─── Refresh button (rate-limit aware via /api/facebook/all-ads) ───

  const lastClientRefresh = useRef<number>(0);
  const refreshNow = useCallback(async () => {
    const now = Date.now();
    if (now - lastClientRefresh.current < 30 * 1000) return; // 30s client throttle
    lastClientRefresh.current = now;
    await Promise.all([loadAds(true), loadEnrichments()]);
  }, [loadAds, loadEnrichments]);

  // ─── Render ───

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <PageHeader
        refreshedAt={refreshedAt}
        onRefresh={refreshNow}
        refreshing={refreshing}
        throttled={throttled}
      />

      <Tabs tab={tab} onChange={setTab} counts={counts} />

      <Filters
        datePreset={datePreset}
        setDatePreset={setDatePreset}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        accounts={accounts}
        storeFilter={storeFilter}
        setStoreFilter={setStoreFilter}
        storeNames={storeNames}
        campaignFilter={campaignFilter}
        setCampaignFilter={setCampaignFilter}
        search={search}
        setSearch={setSearch}
      />

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {toggleError && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">{toggleError}</div>
          <button
            onClick={() => setToggleError(null)}
            className="text-red-300 hover:text-white text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {analyzeError && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>{analyzeError}</div>
        </div>
      )}

      {tab === "winners" && (
        <WinnersPoolToolbar
          poolCount={counts.winners}
          storeFilter={storeFilter}
          onGenerateLog={() => setLogModalOpen(true)}
        />
      )}

      <CreativesTable
        tab={tab}
        rows={filteredRows}
        loading={loading}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k) => {
          if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          else {
            setSortKey(k);
            setSortDir(k === "cpa" ? "asc" : "desc");
          }
        }}
        selectedIds={selectedIds}
        onToggleSelect={(id) =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onRowClick={openRow}
        analyzingId={analyzingId}
        togglingIds={togglingIds}
        onToggleAd={toggleAdStatus}
        attributions={enrichments.attributions}
      />

      {activeRow && (
        <DeconstructionDetailModal
          row={activeRow}
          adName={modalAdName}
          onClose={() => {
            setActiveRow(null);
            loadEnrichments();
          }}
          onRerun={rerunActive}
          rerunning={analyzingId === activeRow.ad_id}
          isTaggedWinner={!!enrichments.winner_pool[activeRow.ad_id]}
          taggingWinner={taggingWinnerId === activeRow.ad_id}
          onToggleWinnerTag={() =>
            toggleWinnerTag(
              activeRow.ad_id,
              !!enrichments.winner_pool[activeRow.ad_id]
            )
          }
        />
      )}

      {logModalOpen && (
        <WinnersLogModal
          storeFilter={storeFilter}
          onClose={() => setLogModalOpen(false)}
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
    </div>
  );
}

// ─── Sub-components ───

function PageHeader({
  refreshedAt,
  onRefresh,
  refreshing,
  throttled,
}: {
  refreshedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  throttled: boolean;
}) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Sparkles size={20} className="text-amber-400" />
          Creatives
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Browse, deconstruct, and curate winners. Winners feed the angle
          generator + format expansion.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {refreshedAt && (
          <span className="text-[11px] text-gray-500">
            Last refreshed: {timeAgo(refreshedAt)}
            {throttled && " · refresh throttled (5 min)"}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-1.5 cursor-pointer disabled:opacity-40"
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Refresh
        </button>
      </div>
    </div>
  );
}

function Tabs({
  tab,
  onChange,
  counts,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  counts: { all: number; winners: number };
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-800">
      {(
        [
          { value: "all" as Tab, label: "All Creatives", n: counts.all },
          { value: "winners" as Tab, label: "Winners Pool", n: counts.winners },
        ] as const
      ).map((t) => {
        const active = tab === t.value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${active ? "border-amber-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}
          >
            {t.label}{" "}
            <span
              className={`ml-1 text-[11px] ${active ? "text-amber-300" : "text-gray-500"}`}
            >
              {t.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Filters({
  datePreset,
  setDatePreset,
  accountFilter,
  setAccountFilter,
  accounts,
  storeFilter,
  setStoreFilter,
  storeNames,
  campaignFilter,
  setCampaignFilter,
  search,
  setSearch,
}: {
  datePreset: DatePreset;
  setDatePreset: (v: DatePreset) => void;
  accountFilter: string;
  setAccountFilter: (v: string) => void;
  accounts: { id: string; name: string }[];
  storeFilter: string;
  setStoreFilter: (v: string) => void;
  storeNames: string[];
  campaignFilter: CampaignType;
  setCampaignFilter: (v: CampaignType) => void;
  search: string;
  setSearch: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={datePreset}
        onChange={(e) => setDatePreset(e.target.value as DatePreset)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <select
        value={storeFilter}
        onChange={(e) => setStoreFilter(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
      >
        <option value="ALL">All stores</option>
        {storeNames.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 max-w-[200px]"
      >
        <option value="ALL">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        value={campaignFilter}
        onChange={(e) => setCampaignFilter(e.target.value as CampaignType)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
        title="Filter by campaign type. Testing campaigns are where new winning creatives are usually found."
      >
        <option value="testing">Testing only</option>
        <option value="scaling">Scaling only</option>
        <option value="all">All campaigns</option>
      </select>
      <div className="relative flex-1 min-w-[200px]">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
        />
        <input
          type="text"
          placeholder="Search ad / campaign / label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
        />
      </div>
    </div>
  );
}

function WinnersPoolToolbar({
  poolCount,
  storeFilter,
  onGenerateLog,
}: {
  poolCount: number;
  storeFilter: string;
  onGenerateLog: () => void;
}) {
  const ready = poolCount >= 1;
  return (
    <div className="flex flex-wrap items-center gap-3 bg-amber-900/15 border border-amber-700/40 rounded-lg p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-100">
          <span className="font-semibold">{poolCount}</span> ad
          {poolCount === 1 ? "" : "s"} in pool
          {storeFilter !== "ALL" ? ` for ${storeFilter}` : ""}
        </p>
        <p className="text-[11px] text-amber-300/70 mt-0.5">
          Generate the Winning &amp; Losing Ads Log to feed into your Claude
          Project. Tip: tag a few notable losers too — the Log learns from
          comparison.
        </p>
      </div>
      <button
        disabled={!ready}
        onClick={onGenerateLog}
        title={
          ready
            ? "Generate the structured Log document for Claude Project"
            : "Tag at least one ad to enable"
        }
        className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 cursor-pointer"
      >
        <Sparkles size={14} />
        Generate Log
      </button>
    </div>
  );
}

function CompareToolbar({
  selected,
  stores,
  canCompare,
  comparing,
  progress,
  error,
  onRun,
  onClear,
}: {
  selected: number;
  stores: (string | null)[];
  canCompare: boolean;
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
  const filteredStores = stores.filter((s): s is string => !!s);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-gray-400">
          <span className="text-white font-bold text-base mr-2">
            {selected}
          </span>
          selected · max {COMPARE_MAX}
          {selected < COMPARE_MIN && ` · need ≥${COMPARE_MIN}`}
          {filteredStores.length === 1 && (
            <span className="ml-2 text-emerald-400">
              · {filteredStores[0]}
            </span>
          )}
          {filteredStores.length > 1 && (
            <span className="ml-2 text-red-400">
              · Mixed ({filteredStores.join(", ")})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected > 0 && (
            <button
              onClick={onClear}
              disabled={comparing}
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 cursor-pointer disabled:opacity-40"
            >
              Clear
            </button>
          )}
          <button
            onClick={onRun}
            disabled={!canCompare}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {comparing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitCompareArrows size={12} />
            )}
            {comparing ? "Working…" : "Compare"}
          </button>
        </div>
      </div>
      {progress && (
        <div className="text-[11px] text-blue-300 flex items-center gap-2">
          <Loader2 size={11} className="animate-spin" />
          {progress.stage === "deconstructing"
            ? `Deconstructing ${progress.current}/${progress.total}: ${progress.label}`
            : progress.label}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-300 flex items-center gap-2">
          <AlertCircle size={11} />
          {error}
        </div>
      )}
    </div>
  );
}

function CreativesTable({
  tab,
  rows,
  loading,
  sortKey,
  sortDir,
  onSort,
  selectedIds,
  onToggleSelect,
  onRowClick,
  analyzingId,
  togglingIds,
  onToggleAd,
  attributions,
}: {
  tab: Tab;
  rows: EnrichedRow[];
  loading: boolean;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRowClick: (row: EnrichedRow) => void;
  analyzingId: string | null;
  togglingIds: Set<string>;
  onToggleAd: (adId: string, currentStatus: string) => void;
  attributions: Record<string, Attribution>;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-500" size={20} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500 text-sm">
        {tab === "winners"
          ? "Walang winners pa. Mag-deconstruct ka muna ng ad, then click '+ Add to Winners' sa modal."
          : "Walang ads sa selected filters."}
      </div>
    );
  }

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              {tab === "winners" && (
                <th className="px-3 py-2 text-left w-8"></th>
              )}
              <th className="px-3 py-2 text-left">Ad</th>
              <th className="px-3 py-2 text-left">Store</th>
              <th className="px-3 py-2 text-left">Status</th>
              <SortHeader
                label="Spend"
                k="spend"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Purchases"
                k="purchases"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="ROAS"
                k="roas"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="CPP"
                k="cpa"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <th className="px-3 py-2 text-left">Analyzed</th>
              <th className="px-3 py-2 text-left">Winner</th>
              {tab === "winners" && (
                <SortHeader
                  label="Added"
                  k="linked_at"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  align="left"
                />
              )}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((r) => {
              const selected = selectedIds.has(r.ad_id);
              return (
                <tr
                  key={r.ad_id}
                  className={`hover:bg-gray-900/50 transition-colors cursor-pointer ${selected ? "bg-emerald-900/15" : ""}`}
                  onClick={() => onRowClick(r)}
                >
                  {tab === "winners" && (
                    <td
                      className="px-3 py-2.5 align-middle"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(r.ad_id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect(r.ad_id)}
                        className="rounded cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {r.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail_url}
                          alt=""
                          className="w-12 aspect-video object-cover rounded border border-gray-800 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 aspect-video rounded bg-gray-800 border border-gray-700 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-white text-xs font-medium truncate max-w-[280px]">
                          {r.ad}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate max-w-[280px]">
                          {r.campaign || "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-300">
                    {r.store ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <StatusCell
                      status={r.status}
                      adId={r.ad_id}
                      toggling={togglingIds.has(r.ad_id)}
                      onToggle={onToggleAd}
                      attribution={attributions[r.ad_id] ?? null}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-200">
                    ₱{Math.round(r.spend).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-200">
                    {r.purchases}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    <span
                      className={
                        r.roas >= 5
                          ? "text-emerald-300"
                          : r.roas >= 2
                            ? "text-yellow-300"
                            : "text-gray-400"
                      }
                    >
                      {r.roas ? `${r.roas.toFixed(2)}x` : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-200">
                    {r.cpa ? `₱${Math.round(r.cpa)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {analyzingId === r.ad_id ? (
                      <span className="inline-flex items-center gap-1 text-blue-300">
                        <Loader2 size={11} className="animate-spin" />
                        Analyzing…
                      </span>
                    ) : r.analysis ? (
                      r.analysis.has_v2 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 size={11} />
                          v2.0
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-yellow-300">
                          <CheckCircle2 size={11} />
                          legacy
                        </span>
                      )
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.in_winner_pool ? (
                      <span
                        className="inline-flex items-center gap-1 text-amber-300"
                        title={
                          r.pool_tagged_by
                            ? `Tagged by ${r.pool_tagged_by}`
                            : "In Winners Pool"
                        }
                      >
                        <Trophy size={11} />
                        In pool
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  {tab === "winners" && (
                    <td className="px-3 py-2.5 text-[11px] text-gray-400">
                      {r.pool_tagged_at
                        ? timeAgo(r.pool_tagged_at)
                        : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right">
                    {r.preview_url && (
                      <a
                        href={r.preview_url}
                        target="_blank"
                        rel="noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center text-gray-500 hover:text-gray-200 cursor-pointer"
                        title="Open preview in Meta"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className={`px-3 py-2 cursor-pointer select-none hover:text-gray-200 ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => onSort(k)}
    >
      {label} {arrow && <span className="text-amber-400">{arrow}</span>}
    </th>
  );
}

// ─── Helpers ───

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

// Wand2 was imported above for a potential "Generate from this winner" CTA;
// leaving the import for the next iteration that wires it in.
void Wand2;

// Render an ad's effective_status as a colored badge plus a toggle button
// (when the status is one the user can actually flip). Clicking the toggle
// hits /api/facebook/manage with toggle_status — 1 FB API call.
function StatusCell({
  status,
  adId,
  toggling,
  onToggle,
  attribution,
}: {
  status: string;
  adId: string;
  toggling: boolean;
  onToggle: (adId: string, currentStatus: string) => void;
  attribution: Attribution | null;
}) {
  const { label, className } = statusBadgeStyle(status);
  const canToggle = TOGGLEABLE_STATUSES.has(status);
  const isActive = status === "ACTIVE";

  // Subtitle only makes sense when the ad is currently off / problematic.
  // We skip it when the badge is already "Rejected" (FB-side, no extra
  // signal from our logs) and when status is ACTIVE.
  const showSubtitle =
    attribution &&
    status !== "ACTIVE" &&
    !status.includes("DISAPPROVED");

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${className}`}
          title={status}
        >
          {label}
        </span>
        {canToggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(adId, status);
            }}
            disabled={toggling}
            title={isActive ? "Pause ad" : "Activate ad"}
            className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
              isActive
                ? "text-gray-400 hover:text-red-300 hover:bg-red-900/30"
                : "text-gray-400 hover:text-green-300 hover:bg-green-900/30"
            }`}
          >
            {toggling ? (
              <Loader2 size={12} className="animate-spin" />
            ) : isActive ? (
              <Pause size={12} />
            ) : (
              <Play size={12} />
            )}
          </button>
        )}
      </div>
      {showSubtitle && attribution && (
        <AttributionSubtitle attribution={attribution} />
      )}
    </div>
  );
}

function AttributionSubtitle({ attribution }: { attribution: Attribution }) {
  const when = timeAgo(attribution.at);
  if (attribution.source === "autopilot") {
    const reason = attribution.reason
      ? attribution.reason.replace(/_/g, " ")
      : "rule";
    return (
      <p
        className="text-[10px] text-gray-500 leading-tight max-w-[180px] truncate"
        title={`Auto-paused (${reason}) ${when}`}
      >
        <span className="text-purple-400">Auto</span> · {reason} · {when}
      </p>
    );
  }
  // manual
  const who = attribution.actor_name ?? "Someone";
  return (
    <p
      className="text-[10px] text-gray-500 leading-tight max-w-[180px] truncate"
      title={`Manually paused by ${who} ${when}`}
    >
      {who} · {when}
    </p>
  );
}
