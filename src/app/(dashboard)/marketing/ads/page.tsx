"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { cachedFetch, formatLastRefreshed } from "@/lib/client-cache";
import {
  RefreshCw,
  Settings,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  Pencil,
  X,
  Loader2,
  Zap,
  Bot,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { DatePreset } from "@/lib/facebook/types";
import { QuickActionsModal } from "@/components/marketing/quick-actions-modal";
import { AutopilotModal } from "@/components/marketing/autopilot-modal";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 14 Days", value: "last_14d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
];

interface AdRow {
  account: string;
  account_id: string;
  campaign: string;
  campaign_id: string;
  adset: string;
  adset_id: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  link_clicks: number;
  cpa: number;
  roas: number;
  add_to_cart: number;
  purchases: number;
  reach: number;
  impressions: number;
  ctr: number;
  preview_url: string | null;
  thumbnail_url: string | null;
  updated_time: string | null;
  adset_updated_time: string | null;
  campaign_updated_time: string | null;
  start_time: string | null;
}

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  status: string;
  is_active: boolean;
}

interface BudgetInfo {
  daily_budget: number | null;
  lifetime_budget: number | null;
}

// Aggregated row for campaign/adset level
interface AggRow {
  name: string;
  entity_id: string; // campaign or adset ID for API calls
  count: number;
  active_count: number; // how many child ads are ACTIVE
  unknown_count: number; // how many child ads have UNKNOWN status (FB structure fetch issue)
  scheduled: boolean; // start_time is in the future
  updated_time: string | null;
  start_time: string | null;
  spend: number;
  link_clicks: number;
  cpa: number;
  roas: number;
  add_to_cart: number;
  purchases: number;
  reach: number;
  impressions: number;
  ctr: number;
}

type DrillLevel = "campaign" | "adset" | "ad";
type SortKey = string;

function aggregate(
  rows: AdRow[],
  groupBy: "campaign" | "adset",
  idField: "campaign_id" | "adset_id"
): AggRow[] {
  const map = new Map<string, { rows: AdRow[]; id: string }>();
  for (const r of rows) {
    const key = r[groupBy];
    if (!map.has(key)) map.set(key, { rows: [], id: r[idField] });
    map.get(key)!.rows.push(r);
  }

  const result: AggRow[] = [];
  for (const [name, { rows: group, id }] of map) {
    const spend = group.reduce((s, r) => s + r.spend, 0);
    const purchases = group.reduce((s, r) => s + r.purchases, 0);
    const link_clicks = group.reduce((s, r) => s + (r.link_clicks ?? 0), 0);
    const add_to_cart = group.reduce((s, r) => s + r.add_to_cart, 0);
    const reach = group.reduce((s, r) => s + r.reach, 0);
    const impressions = group.reduce((s, r) => s + r.impressions, 0);
    const purchaseValue =
      spend > 0
        ? group.reduce((s, r) => s + r.roas * r.spend, 0) / spend
        : 0;

    const active_count = group.filter((r) => r.status === "ACTIVE").length;
    const unknown_count = group.filter((r) => r.status === "UNKNOWN").length;

    // Prefer entity's OWN updated_time, but fall back to the most recent
    // child ad updated_time, then to campaign — so the column is never empty
    // when FB returned ANY date for this hierarchy.
    const ownUpdated =
      groupBy === "adset"
        ? group[0]?.adset_updated_time
        : group[0]?.campaign_updated_time;
    const adUpdatedTimes = group
      .map((r) => r.updated_time)
      .filter(Boolean) as string[];
    const latestAdUpdated =
      adUpdatedTimes.length > 0 ? adUpdatedTimes.sort().reverse()[0] : null;
    const entityUpdated =
      ownUpdated ||
      latestAdUpdated ||
      group[0]?.campaign_updated_time ||
      null;

    // Earliest start_time
    const startTimes = group
      .map((r) => r.start_time)
      .filter(Boolean) as string[];
    const earliestStart =
      startTimes.length > 0 ? startTimes.sort()[0] : null;
    const scheduled =
      !!earliestStart && new Date(earliestStart).getTime() > Date.now();

    result.push({
      name,
      entity_id: id,
      count: group.length,
      active_count,
      unknown_count,
      scheduled,
      updated_time: entityUpdated,
      start_time: earliestStart,
      spend,
      link_clicks,
      cpa: purchases > 0 ? spend / purchases : 0,
      roas: purchaseValue,
      add_to_cart,
      purchases,
      reach,
      impressions,
      ctr: impressions > 0 ? (link_clicks / impressions) * 100 : 0,
    });
  }
  return result;
}

const METRIC_COLS: { key: string; label: string }[] = [
  { key: "spend", label: "Spent" },
  { key: "cpa", label: "CPA" },
  { key: "purchases", label: "Purchases" },
  { key: "roas", label: "ROAS" },
  { key: "add_to_cart", label: "ATC" },
  { key: "link_clicks", label: "Clicks" },
  { key: "cost_per_lpv", label: "Cost/LPV" },
  { key: "reach", label: "Reach" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr", label: "CTR" },
];

export default function AdsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [allRows, setAllRows] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterAccount, setFilterAccount] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [role, setRole] = useState<string>("");
  const [budgets, setBudgets] = useState<Record<string, BudgetInfo>>({});

  // Drill-down state
  const [drillLevel, setDrillLevel] = useState<DrillLevel>("campaign");
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [selectedAdset, setSelectedAdset] = useState<string | null>(null);

  // Quick Actions modal
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  // Autopilot modal + status
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean | null>(
    null
  );

  // Admin action states
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<{
    id: string;
    name: string;
    current: BudgetInfo;
  } | null>(null);
  const [budgetValue, setBudgetValue] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = role === "admin";

  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const [updating, setUpdating] = useState(false); // soft loading (has stale data)

  const fetchData = useCallback(async (forceRefresh = false) => {
    // If we already have data, show "updating" instead of full loading
    if (allRows.length > 0) {
      setUpdating(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const url = `/api/facebook/all-ads?date_preset=${datePreset}&account=${filterAccount}`;
      const result = await cachedFetch<Record<string, unknown>>(url, { forceRefresh, ttl: 10 * 60 * 1000 });
      const json = result.data;
      const rows = json.data as typeof allRows;

      // If we got 0 ads but already had data, keep the old data (likely a rate limit error)
      if (rows && rows.length === 0 && allRows.length > 0) {
        // Don't overwrite good data with empty response — likely rate limited
        const serverTime = json.refreshed_at ? new Date(json.refreshed_at as string).getTime() : result.timestamp;
        setLastRefreshed(formatLastRefreshed(serverTime) + (json.from_cache ? " (cached)" : ""));
      } else {
        setAllRows(rows || []);
        if (json.accounts) setAccounts(json.accounts as typeof accounts);
        if (json.role) setRole(json.role as string);
        if (json.budgets) setBudgets(json.budgets as typeof budgets);
        const serverTime = json.refreshed_at ? new Date(json.refreshed_at as string).getTime() : result.timestamp;
        setLastRefreshed(formatLastRefreshed(serverTime) + (json.from_cache ? " (cached)" : ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }, [datePreset, filterAccount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll Autopilot status (header badge)
  const loadAutopilotStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/facebook/autopilot/config");
      if (!res.ok) return;
      const json = await res.json();
      setAutopilotEnabled(!!json.config?.enabled);
    } catch {
      // silent — header badge is non-critical
    }
  }, []);

  useEffect(() => {
    if (role === "admin") loadAutopilotStatus();
  }, [role, loadAutopilotStatus]);


  // Reset drill-down when date/account changes
  useEffect(() => {
    setDrillLevel("campaign");
    setSelectedCampaign(null);
    setSelectedAdset(null);
  }, [datePreset, filterAccount]);

  // Lazy-load FB creative preview links when drilled to ad level.
  // /all-ads no longer returns creative{} (too slow, was causing
  // timeouts). We fetch preview/thumbnail only for the ads currently
  // being viewed.
  const [loadedCreatives, setLoadedCreatives] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (drillLevel !== "ad" || !selectedCampaign || !selectedAdset) return;

    const targetIds = allRows
      .filter(
        (r) =>
          r.campaign === selectedCampaign &&
          r.adset === selectedAdset &&
          !loadedCreatives.has(r.ad_id) &&
          r.preview_url === null
      )
      .map((r) => r.ad_id);

    if (targetIds.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/facebook/ad-creatives?ids=${targetIds.join(",")}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          creatives: Record<
            string,
            { preview_url: string | null; thumbnail_url: string | null }
          >;
        };
        if (cancelled) return;
        const creatives = json.creatives ?? {};
        setAllRows((prev) =>
          prev.map((row) => {
            const c = creatives[row.ad_id];
            if (!c) return row;
            return {
              ...row,
              preview_url: c.preview_url,
              thumbnail_url: c.thumbnail_url,
            };
          })
        );
        setLoadedCreatives((prev) => {
          const next = new Set(prev);
          for (const id of targetIds) next.add(id);
          return next;
        });
      } catch {
        // Preview links are non-critical — fail silently
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [drillLevel, selectedCampaign, selectedAdset, allRows, loadedCreatives]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // --- Admin actions ---
  const handleToggleStatus = async (
    entityId: string,
    currentStatus: string
  ) => {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setTogglingId(entityId);
    setActionError(null);
    try {
      const res = await fetch("/api/facebook/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_status",
          entity_id: entityId,
          new_status: newStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // Update local state instead of refetching everything
      setAllRows((prev) =>
        prev.map((row) => {
          const r = row as unknown as Record<string, unknown>;
          // Update status for matching entity at any level
          if (
            r.ad_id === entityId ||
            r.adset_id === entityId ||
            r.campaign_id === entityId
          ) {
            return { ...row, status: newStatus } as typeof row;
          }
          return row;
        })
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  };

  const handleSaveBudget = async () => {
    if (!editingBudget) return;
    const amount = parseFloat(budgetValue);
    if (isNaN(amount) || amount < 0) {
      setActionError("Enter a valid budget amount");
      return;
    }
    setBudgetSaving(true);
    setActionError(null);
    try {
      const budget = editingBudget.current;
      const body: Record<string, unknown> = {
        action: "update_budget",
        entity_id: editingBudget.id,
      };
      // Use same budget type (daily or lifetime) as current
      if (budget.daily_budget != null) {
        body.daily_budget = amount;
      } else {
        body.lifetime_budget = amount;
      }

      const res = await fetch("/api/facebook/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // Update local budget state instead of refetching
      const budgetId = editingBudget.id;
      const currentBudget = editingBudget.current;
      setBudgets((prev) => ({
        ...prev,
        [budgetId]: {
          daily_budget: currentBudget.daily_budget != null ? amount : null,
          lifetime_budget: currentBudget.lifetime_budget != null ? amount : null,
        },
      }));
      setEditingBudget(null);
      setBudgetValue("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update budget");
    } finally {
      setBudgetSaving(false);
    }
  };

  // Filter rows by status
  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (filterStatus !== "ALL" && r.status !== filterStatus) return false;
      return true;
    });
  }, [allRows, filterStatus]);

  const statusOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(allRows.map((r) => r.status)))],
    [allRows]
  );

  // Unique campaigns (for Autopilot watchlist tab)
  const campaignOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        account_id: string;
        campaign_id: string;
        campaign_name: string;
        status: string;
        ad_count: number;
      }
    >();
    for (const r of allRows) {
      const existing = map.get(r.campaign_id);
      if (existing) {
        existing.ad_count += 1;
      } else {
        map.set(r.campaign_id, {
          account_id: r.account_id,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign,
          status: r.status,
          ad_count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.campaign_name.localeCompare(b.campaign_name)
    );
  }, [allRows]);

  // Raw ad rows in current scope (respects account/status filter + drill)
  // Used by Quick Actions so bulk pause/boost only affects what user sees.
  const scopedRawRows = useMemo(() => {
    if (drillLevel === "campaign") return filteredRows;
    if (drillLevel === "adset" && selectedCampaign) {
      return filteredRows.filter((r) => r.campaign === selectedCampaign);
    }
    if (drillLevel === "ad" && selectedCampaign && selectedAdset) {
      return filteredRows.filter(
        (r) => r.campaign === selectedCampaign && r.adset === selectedAdset
      );
    }
    return filteredRows;
  }, [filteredRows, drillLevel, selectedCampaign, selectedAdset]);

  // Build display data based on drill level
  const displayData = useMemo(() => {
    if (drillLevel === "campaign") {
      return {
        type: "agg" as const,
        rows: aggregate(filteredRows, "campaign", "campaign_id"),
      };
    }
    if (drillLevel === "adset" && selectedCampaign) {
      const campaignRows = filteredRows.filter(
        (r) => r.campaign === selectedCampaign
      );
      return {
        type: "agg" as const,
        rows: aggregate(campaignRows, "adset", "adset_id"),
      };
    }
    if (drillLevel === "ad" && selectedCampaign && selectedAdset) {
      const adRows = filteredRows.filter(
        (r) => r.campaign === selectedCampaign && r.adset === selectedAdset
      );
      return { type: "ad" as const, rows: adRows };
    }
    return { type: "agg" as const, rows: [] as AggRow[] };
  }, [drillLevel, selectedCampaign, selectedAdset, filteredRows]);

  // Sort
  const sortedData = useMemo(() => {
    const rows = [...displayData.rows];
    rows.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey];
      const bVal = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const an = (aVal as number) ?? 0;
      const bn = (bVal as number) ?? 0;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return rows;
  }, [displayData, sortKey, sortDir]);

  // Totals for summary bar
  const totals = useMemo(() => {
    const rows = filteredRows;
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const purchases = rows.reduce((s, r) => s + r.purchases, 0);
    const link_clicks = rows.reduce((s, r) => s + (r.link_clicks ?? 0), 0);
    const reach = rows.reduce((s, r) => s + r.reach, 0);
    return { count: rows.length, spend, purchases, link_clicks, reach };
  }, [filteredRows]);

  const fmt = (n: number) =>
    `₱${n.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const fmtNum = (n: number) => (n ?? 0).toLocaleString("en-PH");
  const fmtPct = (n: number) => `${(n ?? 0).toFixed(2)}%`;

  const renderMetric = (row: Record<string, unknown>, key: string) => {
    const v = (row[key] as number) ?? 0;
    switch (key) {
      case "cpa": {
        // Color-code CPA: green <200, yellow 200-350, red >350
        // Skip color when 0 (no purchases) since CPA is meaningless
        if (v <= 0) return <span className="text-gray-500">{fmt(v)}</span>;
        const color =
          v < 200
            ? "text-green-400"
            : v <= 350
              ? "text-yellow-400"
              : "text-red-400";
        return <span className={color}>{fmt(v)}</span>;
      }
      case "spend":
      case "cost_per_lpv":
        return fmt(v);
      case "roas":
        return `${v.toFixed(2)}x`;
      case "ctr":
        return fmtPct(v);
      default:
        return fmtNum(v);
    }
  };

  // Remap sort key when moving between drill levels — most numeric metrics
  // work at every level, but "name"/"ad"/"status"/"count" are level-specific
  const remapSortKey = (key: SortKey, toLevel: DrillLevel): SortKey => {
    if (toLevel === "ad") {
      if (key === "name") return "ad";
      if (key === "count") return "spend";
      return key;
    }
    if (key === "ad") return "name";
    if (key === "status") return "spend";
    return key;
  };

  const handleRowClick = (row: AggRow | AdRow) => {
    if (drillLevel === "campaign") {
      setSelectedCampaign((row as AggRow).name);
      setDrillLevel("adset");
      setSortKey(remapSortKey(sortKey, "adset"));
    } else if (drillLevel === "adset") {
      setSelectedAdset((row as AggRow).name);
      setDrillLevel("ad");
      setSortKey(remapSortKey(sortKey, "ad"));
    }
  };

  const handleBreadcrumb = (level: DrillLevel) => {
    if (level === "campaign") {
      setDrillLevel("campaign");
      setSelectedCampaign(null);
      setSelectedAdset(null);
      setSortKey(remapSortKey(sortKey, "campaign"));
    } else if (level === "adset") {
      setDrillLevel("adset");
      setSelectedAdset(null);
      setSortKey(remapSortKey(sortKey, "adset"));
    }
  };

  const nameLabel =
    drillLevel === "campaign"
      ? "Campaign"
      : drillLevel === "adset"
        ? "Ad Set"
        : "Ad";

  const problemAccounts = accounts.filter((a) => !a.is_active);

  const renderStatusBadge = (s: string) => {
    let style = "text-gray-400 bg-gray-700/50";
    if (s === "ACTIVE") style = "text-green-400 bg-green-900/50";
    else if (s.includes("PAUSED"))
      style = "text-yellow-400 bg-yellow-900/50";
    else if (s.includes("DELETED") || s === "OFF")
      style = "text-red-400 bg-red-900/50";
    else if (s.includes("ACCOUNT"))
      style = "text-orange-400 bg-orange-900/50";
    else if (s.includes("ARCHIVED"))
      style = "text-gray-500 bg-gray-800/50";
    return (
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase whitespace-nowrap ${style}`}
      >
        {s}
      </span>
    );
  };

  // Get the entity ID and toggleable status for a row
  const getEntityInfo = (row: AggRow | AdRow) => {
    if (drillLevel === "ad") {
      const adRow = row as AdRow;
      return { id: adRow.ad_id, status: adRow.status };
    }
    const aggRow = row as AggRow;
    return { id: aggRow.entity_id, status: null };
  };

  // Check if status is toggleable (only ACTIVE or PAUSED)
  const isToggleable = (status: string) =>
    status === "ACTIVE" || status === "PAUSED";

  const renderBudgetBadge = (entityId: string, name: string) => {
    const budget = budgets[entityId];
    if (!budget) return null;
    const amount = budget.daily_budget ?? budget.lifetime_budget;
    if (amount == null) return null;
    const type = budget.daily_budget != null ? "daily" : "lifetime";

    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 ml-2">
        <span className="bg-gray-700/70 px-1.5 py-0.5 rounded">
          {fmt(amount)}/{type === "daily" ? "day" : "total"}
        </span>
        {isAdmin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingBudget({ id: entityId, name, current: budget });
              setBudgetValue(amount.toString());
              setActionError(null);
            }}
            className="text-gray-500 hover:text-white transition-colors cursor-pointer"
            title="Edit budget"
          >
            <Pencil size={11} />
          </button>
        )}
      </span>
    );
  };

  // Toggle switch component
  const ToggleSwitch = ({
    entityId,
    status,
  }: {
    entityId: string;
    status: string;
  }) => {
    if (!isAdmin || !isToggleable(status)) return null;
    const isActive = status === "ACTIVE";
    const isToggling = togglingId === entityId;

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleToggleStatus(entityId, status);
        }}
        disabled={isToggling}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50"
        style={{
          backgroundColor: isActive
            ? "rgb(34 197 94 / 0.6)"
            : "rgb(75 85 99 / 0.6)",
        }}
        title={isActive ? "Pause" : "Activate"}
      >
        {isToggling ? (
          <Loader2
            size={10}
            className="absolute left-1/2 -translate-x-1/2 text-white animate-spin"
          />
        ) : (
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              isActive ? "translate-x-[18px]" : "translate-x-[3px]"
            }`}
          />
        )}
      </button>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Ad Performance</h1>
          <p className="text-gray-400 mt-1">
            Facebook Ads — {accounts.length} ad account
            {accounts.length !== 1 ? "s" : ""}
            {lastRefreshed && <span className="text-gray-600 ml-2">· {lastRefreshed}</span>}
            {updating && <span className="text-blue-400 ml-2">· Updating...</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/settings"
            className="p-2 text-gray-400 hover:text-white transition-colors"
            title="Token Settings"
          >
            <Settings size={20} />
          </a>
          {isAdmin && (
            <button
              onClick={() => setAutopilotOpen(true)}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer border ${
                autopilotEnabled
                  ? "bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border-gray-600/40"
              }`}
              title={
                autopilotEnabled
                  ? "Autopilot is ON — auto-pausing losers hourly"
                  : "Autopilot is OFF — click to configure"
              }
            >
              <Bot size={14} />
              Autopilot
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  autopilotEnabled
                    ? "bg-green-400 animate-pulse"
                    : "bg-gray-500"
                }`}
              />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setQuickActionsOpen(true)}
              disabled={loading || allRows.length === 0}
              className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              title="Bulk pause bleeders or boost winners"
            >
              <Zap size={14} />
              Quick Actions
            </button>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>


      {/* Action error toast */}
      {actionError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-200 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Problem accounts banner */}
      {problemAccounts.length > 0 && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700/50 rounded-xl">
          <p className="text-red-300 text-sm font-medium mb-2">
            Account Issues:
          </p>
          <div className="flex flex-wrap gap-2">
            {problemAccounts.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 text-xs bg-red-900/40 text-red-300 px-2 py-1 rounded"
              >
                {a.name}
                <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-red-800 text-red-200 uppercase">
                  {a.status}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Date Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => setDatePreset(preset.value)}
            disabled={loading || updating}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              loading || updating ? "cursor-wait" : "cursor-pointer"
            } ${
              datePreset === preset.value
                ? "bg-white text-gray-900"
                : "bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400"
            }`}
          >
            {preset.label}
            {datePreset === preset.value && updating && (
              <RefreshCw size={10} className="inline ml-1 animate-spin" />
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-5 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Account:</label>
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">ALL</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {!a.is_active ? `(${a.status})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Bar */}
      {!loading && (
        <div className="bg-gray-800/70 border border-gray-700/50 rounded-xl p-4 mb-4 flex flex-wrap gap-6 text-sm">
          <span className="text-gray-400">
            Total: <strong className="text-white">{totals.count} ads</strong>
          </span>
          <span className="text-gray-400">
            Spend: <strong className="text-white">{fmt(totals.spend)}</strong>
          </span>
          <span className="text-gray-400">
            Clicks:{" "}
            <strong className="text-white">{fmtNum(totals.link_clicks)}</strong>
          </span>
          <span className="text-gray-400">
            Purchases:{" "}
            <strong className="text-white">{fmtNum(totals.purchases)}</strong>
          </span>
          <span className="text-gray-400">
            Reach:{" "}
            <strong className="text-white">{fmtNum(totals.reach)}</strong>
          </span>
        </div>
      )}

      {/* Breadcrumb */}
      {drillLevel !== "campaign" && (
        <div className="flex items-center gap-1.5 mb-4 text-sm">
          <button
            onClick={() => handleBreadcrumb("campaign")}
            className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            All Campaigns
          </button>
          {selectedCampaign && (
            <>
              <ChevronRight size={14} className="text-gray-600" />
              {drillLevel === "ad" ? (
                <button
                  onClick={() => handleBreadcrumb("adset")}
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer max-w-[300px] truncate"
                >
                  {selectedCampaign}
                </button>
              ) : (
                <span className="text-white max-w-[300px] truncate">
                  {selectedCampaign}
                </span>
              )}
            </>
          )}
          {selectedAdset && drillLevel === "ad" && (
            <>
              <ChevronRight size={14} className="text-gray-600" />
              <span className="text-white max-w-[300px] truncate">
                {selectedAdset}
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
          {error.includes("token") && (
            <a
              href="/admin/settings"
              className="ml-2 underline text-red-200 hover:text-white"
            >
              Go to Settings
            </a>
          )}
        </div>
      )}

      {/* Budget Edit Modal */}
      {editingBudget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Edit Budget</h3>
              <button
                onClick={() => {
                  setEditingBudget(null);
                  setActionError(null);
                }}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-1 truncate">
              {editingBudget.name}
            </p>
            <p className="text-gray-500 text-xs mb-4">
              {editingBudget.current.daily_budget != null
                ? "Daily Budget"
                : "Lifetime Budget"}
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-gray-400">₱</span>
              <input
                type="number"
                value={budgetValue}
                onChange={(e) => setBudgetValue(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0"
                step="1"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSaveBudget()}
              />
            </div>
            {actionError && (
              <p className="text-red-400 text-xs mb-3">{actionError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingBudget(null);
                  setActionError(null);
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBudget}
                disabled={budgetSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 rounded-lg disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {budgetSaving && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50">
                {/* Toggle column (admin only) */}
                {isAdmin && (
                  <th className="px-2 py-3 w-10" />
                )}
                {/* Name column */}
                <th
                  onClick={() =>
                    handleSort(drillLevel === "ad" ? "ad" : "name")
                  }
                  className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-left"
                >
                  <span className="inline-flex items-center gap-1">
                    {nameLabel}
                    {sortKey === "name" || sortKey === "ad" ? (
                      sortDir === "desc" ? (
                        <ArrowDown size={12} />
                      ) : (
                        <ArrowUp size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-30" />
                    )}
                  </span>
                </th>
                {/* Status column for ad level */}
                {drillLevel === "ad" && (
                  <th
                    onClick={() => handleSort("status")}
                    className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-left"
                  >
                    <span className="inline-flex items-center gap-1">
                      Status
                      {sortKey === "status" ? (
                        sortDir === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={12} className="opacity-30" />
                      )}
                    </span>
                  </th>
                )}
                {/* Count column for aggregated levels */}
                {drillLevel !== "ad" && (
                  <th
                    onClick={() => handleSort("count")}
                    className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-right"
                  >
                    <span className="inline-flex items-center gap-1">
                      {drillLevel === "campaign" ? "Ad Sets" : "Ads"}
                      {sortKey === "count" ? (
                        sortDir === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={12} className="opacity-30" />
                      )}
                    </span>
                  </th>
                )}
                {/* Preview column (ad level only) */}
                {drillLevel === "ad" && (
                  <th className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap text-center">
                    Ad
                  </th>
                )}
                {/* Last Edited column */}
                <th
                  onClick={() => handleSort("updated_time")}
                  className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-right"
                >
                  <span className="inline-flex items-center gap-1">
                    Last Edited
                    {sortKey === "updated_time" ? (
                      sortDir === "desc" ? (
                        <ArrowDown size={12} />
                      ) : (
                        <ArrowUp size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-30" />
                    )}
                  </span>
                </th>
                {/* Days Running column */}
                <th
                  onClick={() => handleSort("start_time")}
                  className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-right"
                >
                  <span className="inline-flex items-center gap-1">
                    Running
                    {sortKey === "start_time" ? (
                      sortDir === "desc" ? (
                        <ArrowDown size={12} />
                      ) : (
                        <ArrowUp size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-30" />
                    )}
                  </span>
                </th>
                {/* Metric columns */}
                {METRIC_COLS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none text-right"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key ? (
                        sortDir === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={12} className="opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-700/20">
                    <td
                      className="px-3 py-3"
                      colSpan={METRIC_COLS.length + (isAdmin ? 4 : 3)}
                    >
                      <div className="h-4 bg-gray-700/40 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : sortedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={METRIC_COLS.length + (isAdmin ? 4 : 3)}
                    className="px-3 py-8 text-center text-gray-500"
                  >
                    <p>No ad data found for this period.</p>
                    {(datePreset === "today" || datePreset === "yesterday") && (
                      <p className="text-xs mt-2 text-gray-600">
                        FB Insights API has a 1-3 hour delay. Try &quot;Last 7
                        Days&quot; for more reliable data.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                sortedData.map((row, i) => {
                  const isClickable = drillLevel !== "ad";
                  const rowData = row as unknown as Record<string, unknown>;
                  const { id: entityId, status: entityStatus } =
                    getEntityInfo(row);
                  const name =
                    drillLevel === "ad"
                      ? (rowData.ad as string)
                      : (rowData.name as string);

                  // For aggregated rows, we don't have a direct status — look it up
                  // For ad rows, status is on the row
                  const toggleStatus =
                    drillLevel === "ad" ? (entityStatus as string) : null;

                  return (
                    <tr
                      key={i}
                      onClick={() => isClickable && handleRowClick(row)}
                      className={`border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors ${
                        isClickable ? "cursor-pointer" : ""
                      }`}
                    >
                      {/* Toggle switch (admin only) */}
                      {isAdmin && (
                        <td className="px-2 py-2.5 text-center">
                          {toggleStatus && (
                            <ToggleSwitch
                              entityId={entityId}
                              status={toggleStatus}
                            />
                          )}
                        </td>
                      )}
                      {/* Name + Status indicator + Budget badge */}
                      <td className="px-3 py-2.5 text-left whitespace-nowrap max-w-[350px]">
                        <span className="text-gray-200 flex items-center gap-1.5">
                          <span className="truncate">{name}</span>
                          {isClickable && (
                            <ChevronRight
                              size={14}
                              className="text-gray-600 flex-shrink-0"
                            />
                          )}
                          {drillLevel !== "ad" && (() => {
                            const agg = rowData as unknown as AggRow;
                            const active = agg.active_count;
                            const unknown = agg.unknown_count;
                            const total = agg.count;
                            const scheduled = agg.scheduled;
                            if (scheduled) {
                              return (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 flex-shrink-0" title="Start date is in the future">
                                  SCHEDULED
                                </span>
                              );
                            }
                            if (unknown === total) {
                              return (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 flex-shrink-0" title="FB structure fetch incomplete — refresh to retry">
                                  {total} ?
                                </span>
                              );
                            }
                            if (active === 0) {
                              return (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-500 flex-shrink-0">
                                  ALL OFF
                                </span>
                              );
                            }
                            if (active < total) {
                              return (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-500 flex-shrink-0">
                                  {active}/{total} ON
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-500 flex-shrink-0">
                                {total} ON
                              </span>
                            );
                          })()}
                          {drillLevel !== "ad" &&
                            renderBudgetBadge(entityId, name)}
                        </span>
                      </td>
                      {/* Status (ad level) */}
                      {drillLevel === "ad" && (
                        <td className="px-3 py-2.5 text-left whitespace-nowrap">
                          {renderStatusBadge(rowData.status as string)}
                        </td>
                      )}
                      {/* Count (aggregated levels) */}
                      {drillLevel !== "ad" && (
                        <td className="px-3 py-2.5 text-right whitespace-nowrap text-gray-400">
                          {(rowData.count as number) ?? 0}
                        </td>
                      )}
                      {/* Preview link (ad level) */}
                      {drillLevel === "ad" && (
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            {rowData.preview_url ? (
                              <a
                                href={rowData.preview_url as string}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs"
                                title="View ad on Facebook"
                              >
                                <ExternalLink size={13} />
                                View
                              </a>
                            ) : (
                              <span className="text-gray-600 text-xs">—</span>
                            )}
                            <Link
                              href={`/marketing/ai-analytics?deconstruct_ad=${encodeURIComponent(rowData.ad_id as string)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors text-xs"
                              title="Analyze this ad's video with AI"
                            >
                              <Sparkles size={13} />
                              Analyze
                            </Link>
                          </div>
                        </td>
                      )}
                      {/* Last Edited */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-gray-400 text-xs">
                        {rowData.updated_time
                          ? new Date(
                              rowData.updated_time as string
                            ).toLocaleDateString("en-PH", {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </td>
                      {/* Days Running / Scheduled */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
                        {rowData.start_time
                          ? (() => {
                              const startMs = new Date(
                                rowData.start_time as string
                              ).getTime();
                              const diffMs = Date.now() - startMs;
                              const days = Math.floor(diffMs / 86400000);
                              if (days < 0) {
                                const startsIn = Math.ceil(-diffMs / 86400000);
                                const dateLabel = new Date(startMs).toLocaleDateString(
                                  "en-PH",
                                  { month: "short", day: "numeric" }
                                );
                                return (
                                  <span
                                    className="text-blue-400"
                                    title={`Scheduled to start ${dateLabel} (in ${startsIn}d)`}
                                  >
                                    📅 {dateLabel}
                                  </span>
                                );
                              }
                              return (
                                <span className="text-gray-400">
                                  {days === 0 ? "Today" : `${days}d`}
                                </span>
                              );
                            })()
                          : <span className="text-gray-400">—</span>}
                      </td>
                      {/* Metrics */}
                      {METRIC_COLS.map((col) => (
                        <td
                          key={col.key}
                          className="px-3 py-2.5 text-right whitespace-nowrap text-white font-medium"
                        >
                          {renderMetric(rowData, col.key)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions Modal */}
      <QuickActionsModal
        open={quickActionsOpen}
        onClose={() => setQuickActionsOpen(false)}
        rows={scopedRawRows}
        budgets={budgets}
        onComplete={() => fetchData(true)}
      />

      {/* Autopilot Modal */}
      {isAdmin && (
        <AutopilotModal
          open={autopilotOpen}
          onClose={() => {
            setAutopilotOpen(false);
            loadAutopilotStatus();
          }}
          campaignOptions={campaignOptions}
          onRefreshData={() => fetchData(true)}
        />
      )}
    </div>
  );
}
