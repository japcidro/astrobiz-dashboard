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
  Play,
  Pause,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { IlpDeconstructionModal } from "@/components/marketing/ilp-deconstruction-modal";
import { WinnersLogModal } from "@/components/marketing/winners-log-modal";

// Minimal shape we need to drive the deconstruction modal — populated
// from the clicked AdRow. The new modal handles fetching the full
// transcript + ILP analysis itself.
interface ActiveAd {
  ad_id: string;
  account_id: string;
  ad: string;
  thumbnail_url: string | null;
  preview_url: string | null;
}
import { deriveStore } from "@/lib/shopify/derive-store";
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
  // FB's created_time for the ad itself. For scaling-campaign duplicates,
  // this is when the ad was promoted (the moment the duplicate was made).
  created_time: string | null;
}

interface Enrichments {
  analyses: Record<string, { has_analysis: true; has_v2: boolean }>;
  scaling: Record<
    string,
    {
      self_is_scaling: boolean;
      in_scaling: boolean;
      scaled_to_campaign: string | null;
    }
  >;
  winner_pool: Record<
    string,
    { tagged_at: string; tagged_by_name: string | null; is_winner: boolean }
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
//   * "all" tab → ads with spend, EXCLUDING anything in the Winners Pool
//     (they have their own tab).
//   * When campaignFilter is "scaling", we relax the spend-gate so that
//     a newly-promoted scaling ad with $0 spend yet still appears (this
//     is the user's primary "did my new scaled ad land?" check).
function isVisible(
  row: EnrichedRow,
  tab: Tab,
  campaignFilter: CampaignType
): boolean {
  if (tab === "winners") return row.in_winner_pool;
  if (row.in_winner_pool) return false;
  if (campaignFilter === "scaling") return true;
  return row.spend > 0;
}

interface EnrichedRow extends AdRow {
  store: string | null;
  analysis: { has_analysis: true; has_v2: boolean } | null;
  in_winner_pool: boolean;
  pool_tagged_at: string | null;
  pool_tagged_by: string | null;
  // User's manual Winner/Loser call. Only meaningful when in_winner_pool=true.
  // Untagged-but-pooled (false) means LOSER / didn't work / didn't fit metrics.
  pool_is_winner: boolean;
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

  // Ad currently mid-tag/untag (Log Pool add/remove toggle)
  const [taggingWinnerId, setTaggingWinnerId] = useState<string | null>(null);
  // Ad currently mid-flip on the Winner/Loser classification
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
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

  // Active ad in the deconstruction modal. The modal handles fetching
  // the transcript + running the ILP 8-zone analysis itself.
  const [activeAd, setActiveAd] = useState<ActiveAd | null>(null);

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
  // ads load, fire background fetches against /api/facebook/ad-creatives
  // and merge the results back into row state.
  //
  // Two safety rails on the request volume:
  //   1) include_zero_spend=1 means the payload can contain 6k+ ads. We
  //      cap thumbnail fetches to the TOP 300 by spend so we don't burn
  //      the FB rate limit (200/hour) with one page load. The rest can
  //      use the gray placeholder — anything not in the top 300 is by
  //      definition low-activity.
  //   2) Even within the cap, we chunk the URL client-side (50 per
  //      request) — joining all IDs into one GET produces a 150KB+ URL
  //      that Vercel rejects with 414 and silently breaks every thumbnail.
  const loadThumbnails = useCallback(async (rows: AdRow[]) => {
    const candidates = [...rows]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 300);
    const ids = candidates.map((r) => r.ad_id).filter(Boolean);
    if (ids.length === 0) return;

    const CHUNK_SIZE = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      chunks.push(ids.slice(i, i + CHUNK_SIZE));
    }

    // As each chunk returns, merge its thumbnails into state so the user
    // sees the visible ads fill in progressively rather than waiting for
    // all 100+ chunks to complete.
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const res = await fetch(
            `/api/facebook/ad-creatives?ids=${chunk.join(",")}`
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
          /* per-chunk failure is non-fatal */
        }
      })
    );
  }, []);

  const loadAds = useCallback(
    async (forceRefresh: boolean) => {
      const setter = forceRefresh ? setRefreshing : setLoading;
      setter(true);
      setError(null);
      setThrottled(false);
      try {
        // include_zero_spend=1 so newly-promoted ads (no spend in the
        // window yet) still appear. The client-side isVisible filter
        // gates the "All" tab back down to spend>0 — the only place this
        // matters is when the user picks the "Scaling only" filter,
        // which intentionally surfaces every ad in the scaling campaign.
        const url = `/api/facebook/all-ads?date_preset=${datePreset}&account=${accountFilter}&include_zero_spend=1${forceRefresh ? "&refresh=1" : ""}`;
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
        setError(e instanceof Error ? e.message : "Log Pool toggle failed");
      } finally {
        setTaggingWinnerId(null);
      }
    },
    [ads, storeNames, taggingWinnerId, loadEnrichments]
  );

  // Flip an ad's manual Winner/Loser classification while it's in the
  // Log Pool. Untagged-as-winner (is_winner=false) means LOSER / didn't
  // work / didn't fit the user's metrics — the Log generator uses this
  // as ground truth for BLOCK 1 Result, not the metrics.
  const toggleWinnerClassification = useCallback(
    async (adId: string, currentlyWinner: boolean) => {
      if (!adId || classifyingId) return;
      setClassifyingId(adId);
      setError(null);
      try {
        const res = await fetch(
          `/api/marketing/winners-pool/${encodeURIComponent(adId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_winner: !currentlyWinner }),
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Classification update failed");
        await loadEnrichments();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Classification update failed"
        );
      } finally {
        setClassifyingId(null);
      }
    },
    [classifyingId, loadEnrichments]
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
        pool_is_winner: !!pool?.is_winner,
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
        created_time: null,
        store: null,
        analysis: enrichments.analyses[adId] ?? null,
        in_winner_pool: true,
        pool_tagged_at: pool.tagged_at,
        pool_tagged_by: pool.tagged_by_name,
        pool_is_winner: !!pool.is_winner,
      });
    }

    return rows;
  }, [ads, storeNames, enrichments]);

  const filteredRows = useMemo(() => {
    let rows = enrichedRows.filter((r) => isVisible(r, tab, campaignFilter));
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
    const pool = enrichedRows.filter((r) => r.in_winner_pool);
    const winners = pool.length;
    const tagged_winners = pool.filter((r) => r.pool_is_winner).length;
    const tagged_losers = winners - tagged_winners;
    return { all, winners, tagged_winners, tagged_losers };
  }, [enrichedRows]);

  // ─── Row click → modal ───
  //
  // Just hand the minimum the modal needs (ad_id + display fields). The
  // modal does its own transcript + ILP-analysis fetch via
  // /api/marketing/deconstructor/from-analysis, and dedupes against
  // ilp_deconstructions by transcript hash so repeat clicks on the same
  // ad are instant + free.
  const openRow = useCallback((row: EnrichedRow) => {
    setActiveAd({
      ad_id: row.ad_id,
      account_id: row.account_id,
      ad: row.ad,
      thumbnail_url: row.thumbnail_url,
      preview_url: row.preview_url,
    });
  }, []);

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

      {tab === "winners" && (
        <WinnersPoolToolbar
          poolCount={counts.winners}
          winnerCount={counts.tagged_winners}
          loserCount={counts.tagged_losers}
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
        togglingIds={togglingIds}
        onToggleAd={toggleAdStatus}
        attributions={enrichments.attributions}
        scaling={enrichments.scaling}
        classifyingId={classifyingId}
        onToggleWinnerClassification={toggleWinnerClassification}
      />

      {activeAd && (
        <IlpDeconstructionModal
          adId={activeAd.ad_id}
          accountId={activeAd.account_id || null}
          adName={activeAd.ad}
          thumbnailUrl={activeAd.thumbnail_url}
          previewUrl={activeAd.preview_url}
          isTaggedWinner={!!enrichments.winner_pool[activeAd.ad_id]}
          taggingWinner={taggingWinnerId === activeAd.ad_id}
          onToggleWinnerTag={() =>
            toggleWinnerTag(
              activeAd.ad_id,
              !!enrichments.winner_pool[activeAd.ad_id]
            )
          }
          onClose={() => {
            setActiveAd(null);
            loadEnrichments();
          }}
        />
      )}

      {logModalOpen && (
        <WinnersLogModal
          storeFilter={storeFilter}
          onClose={() => setLogModalOpen(false)}
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
          Browse, deconstruct, and curate ads. Tag winners AND notable losers
          to the Log Pool — the Log learns from comparison.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {refreshedAt && (
          <span
            className={`text-[11px] ${throttled ? "text-amber-400" : "text-gray-500"}`}
            title={
              throttled
                ? "Your refresh was throttled because another refresh ran < 60s ago. The data shown is the prior cache. Wait a moment and click Refresh again."
                : undefined
            }
          >
            Last refreshed: {timeAgo(refreshedAt)}
            {throttled && " · refresh throttled (try again in ~60s)"}
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
          { value: "winners" as Tab, label: "Log Pool", n: counts.winners },
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
  winnerCount,
  loserCount,
  storeFilter,
  onGenerateLog,
}: {
  poolCount: number;
  winnerCount: number;
  loserCount: number;
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
          <span className="ml-2 text-[11px] font-normal text-amber-300/80">
            ({winnerCount} winner{winnerCount === 1 ? "" : "s"} · {loserCount}{" "}
            loser{loserCount === 1 ? "" : "s"})
          </span>
        </p>
        <p className="text-[11px] text-amber-300/70 mt-0.5">
          Click the Winner/Loser badge per row to set the manual call.
          Untagged-as-winner = LOSER (didn&apos;t work / didn&apos;t fit
          metrics). The Log uses your call as ground truth, not metrics.
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
  togglingIds,
  onToggleAd,
  attributions,
  scaling,
  classifyingId,
  onToggleWinnerClassification,
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
  togglingIds: Set<string>;
  onToggleAd: (adId: string, currentStatus: string) => void;
  attributions: Record<string, Attribution>;
  scaling: Enrichments["scaling"];
  classifyingId: string | null;
  onToggleWinnerClassification: (adId: string, currentlyWinner: boolean) => void;
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
          ? "Walang laman ang Log Pool. Mag-deconstruct ka muna ng ad, then click 'Add to Log Pool' sa modal. Tag winners AND notable losers — the Log learns from comparison."
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-white text-xs font-medium truncate max-w-[260px]">
                            {r.ad}
                          </p>
                          {scaling[r.ad_id]?.in_scaling && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[9px] font-medium bg-purple-900/40 text-purple-300 border border-purple-700/50 rounded px-1 py-0.5 flex-shrink-0"
                              title={
                                scaling[r.ad_id]?.scaled_to_campaign
                                  ? `Creative duplicated into scaling campaign: ${scaling[r.ad_id]?.scaled_to_campaign}`
                                  : "Creative duplicated into a scaling campaign"
                              }
                            >
                              <TrendingUp size={9} />
                              Scaled
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 truncate max-w-[280px]">
                          {r.campaign || "—"}
                        </p>
                        {scaling[r.ad_id]?.self_is_scaling && r.created_time && (
                          <p
                            className="text-[10px] text-purple-400/80 truncate max-w-[280px]"
                            title={`Added to scaling campaign on ${new Date(r.created_time).toLocaleString()}`}
                          >
                            <TrendingUp size={9} className="inline mr-0.5" />
                            Scaled {timeAgo(r.created_time)}
                          </p>
                        )}
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
                    {r.analysis ? (
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
                  <td
                    className="px-3 py-2.5 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.in_winner_pool ? (
                      <button
                        onClick={() =>
                          onToggleWinnerClassification(
                            r.ad_id,
                            r.pool_is_winner
                          )
                        }
                        disabled={classifyingId === r.ad_id}
                        title={
                          r.pool_is_winner
                            ? "Tagged as WINNER. Click to flip to Loser."
                            : "Tagged as LOSER (didn't work / didn't fit metrics). Click to flip to Winner."
                        }
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
                          r.pool_is_winner
                            ? "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25"
                            : "bg-gray-500/10 text-gray-400 border-gray-600/40 hover:bg-gray-500/20 hover:text-gray-300"
                        }`}
                      >
                        {classifyingId === r.ad_id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : r.pool_is_winner ? (
                          <Trophy size={10} />
                        ) : (
                          <XCircle size={10} />
                        )}
                        {r.pool_is_winner ? "Winner" : "Loser"}
                      </button>
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
