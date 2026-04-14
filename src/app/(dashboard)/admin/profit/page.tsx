"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import type {
  DailyPnlRow,
  ProfitSummary,
  ProfitDateFilter,
} from "@/lib/profit/types";
import { ProfitSummaryCards } from "@/components/profit/profit-summary-cards";
import { ProfitDailyTable } from "@/components/profit/profit-daily-table";

const DATE_PRESETS: { label: string; value: ProfitDateFilter }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "This Month", value: "this_month" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "Last 90 Days", value: "last_90d" },
  { label: "Custom", value: "custom" },
];

const defaultSummary: ProfitSummary = {
  revenue: 0,
  order_count: 0,
  cogs: 0,
  ad_spend: 0,
  shipping: 0,
  returns_value: 0,
  net_profit: 0,
  margin_pct: 0,
};

export default function ProfitPage() {
  const [summary, setSummary] = useState<ProfitSummary>(defaultSummary);
  const [daily, setDaily] = useState<DailyPnlRow[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [missingCogsSkus, setMissingCogsSkus] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<ProfitDateFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        store: storeFilter,
        date_filter: dateFilter,
      });
      if (dateFilter === "custom" && customFrom) {
        params.set("date_from", customFrom);
      }
      if (dateFilter === "custom" && customTo) {
        params.set("date_to", customTo);
      }

      const res = await fetch(`/api/profit/daily?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load profit data");

      setSummary(json.summary || defaultSummary);
      setDaily(json.daily || []);
      if (json.stores) setStores(json.stores);
      if (json.missing_cogs_skus) setMissingCogsSkus(json.missing_cogs_skus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profit data");
    } finally {
      setLoading(false);
    }
  }, [dateFilter, storeFilter, customFrom, customTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedDaily = useMemo(() => {
    const result = [...daily];
    result.sort((a, b) => {
      const aVal = a[sortKey as keyof DailyPnlRow];
      const bVal = b[sortKey as keyof DailyPnlRow];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [daily, sortKey, sortDir]);

  const computedTotals = useMemo((): DailyPnlRow => {
    const totals: DailyPnlRow = {
      date: "",
      revenue: 0,
      order_count: 0,
      cogs: 0,
      ad_spend: 0,
      shipping: 0,
      returns_value: 0,
      net_profit: 0,
      margin_pct: 0,
      shipping_projected: false,
      returns_projected: false,
    };
    for (const row of daily) {
      totals.revenue += row.revenue;
      totals.order_count += row.order_count;
      totals.cogs += row.cogs;
      totals.ad_spend += row.ad_spend;
      totals.shipping += row.shipping;
      totals.returns_value += row.returns_value;
      totals.net_profit += row.net_profit;
    }
    totals.margin_pct =
      totals.revenue > 0
        ? (totals.net_profit / totals.revenue) * 100
        : 0;
    return totals;
  }, [daily]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Net Profit</h1>
          <p className="text-gray-400 mt-1">Daily P&L</p>
        </div>
        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Date Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => setDateFilter(preset.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
              dateFilter === preset.value
                ? "bg-white text-gray-900"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Custom Date Range */}
      {dateFilter === "custom" && (
        <div className="flex items-center gap-3 mb-4">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Store Filter */}
      <div className="flex items-center gap-5 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Store:</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Stores</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Missing COGS Warning */}
      {!loading && missingCogsSkus.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
          <div className="text-yellow-300 text-sm">
            <p className="font-medium">
              {missingCogsSkus.length} SKU{missingCogsSkus.length !== 1 ? "s" : ""} missing COGS data
            </p>
            <p className="text-yellow-400/70 mt-0.5">
              {missingCogsSkus.slice(0, 5).join(", ")}
              {missingCogsSkus.length > 5 ? ` and ${missingCogsSkus.length - 5} more` : ""}
              {" — "}
              <a
                href={`/admin/cogs?add_skus=${encodeURIComponent(missingCogsSkus.join(","))}`}
                className="underline hover:text-yellow-200 transition-colors"
              >
                Manage COGS
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="mb-4">
        <ProfitSummaryCards summary={summary} loading={loading} />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Daily Table */}
      {!loading && (
        <ProfitDailyTable
          rows={sortedDaily}
          totals={computedTotals}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

    </div>
  );
}
