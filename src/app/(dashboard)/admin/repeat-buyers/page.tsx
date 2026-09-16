"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, Download, Store, Truck, AlertTriangle } from "lucide-react";
import {
  type CountMode,
  type RepeatBuyer,
  type RepeatBuyerSort,
  type RepeatBuyersSummary,
} from "@/lib/shopify/repeat-buyers";

interface ParcelFreshness {
  last_upload_at: string | null;
  latest_parcel_date: string | null;
  days_behind: number | null;
  is_stale: boolean;
}
import { RepeatBuyersSummaryCards } from "@/components/orders/repeat-buyers-summary-cards";
import { RepeatBuyersTable } from "@/components/orders/repeat-buyers-table";
import { RepeatBuyerDetailPanel } from "@/components/orders/repeat-buyer-detail-panel";

const WINDOW_OPTIONS = [
  { label: "Last 30 Days", value: 30 },
  { label: "Last 90 Days", value: 90 },
  { label: "Last 6 Months", value: 180 },
  { label: "Last 12 Months", value: 365 },
];

const MIN_ORDER_OPTIONS = [
  { label: "2+ orders", value: 2 },
  { label: "3+ orders", value: 3 },
  { label: "5+ orders", value: 5 },
];

const defaultSummary: RepeatBuyersSummary = {
  window_days: 180,
  min_orders: 2,
  count_mode: "delivered",
  total_buyers: 0,
  repeat_buyers: 0,
  repeat_rate_pct: 0,
  reseller_candidates: 0,
  total_orders: 0,
  repeat_orders: 0,
  total_revenue: 0,
  repeat_revenue: 0,
  repeat_revenue_pct: 0,
  repeat_units: 0,
  avg_orders_per_repeat_buyer: 0,
  avg_repeat_buyer_value: 0,
  avg_days_between_orders: null,
  delivered_orders: 0,
  returned_orders: 0,
  in_transit_orders: 0,
  unverified_orders: 0,
  cancelled_orders: 0,
  parcel_coverage_pct: 0,
  rts_rate_pct: null,
  rts_value: 0,
};

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function RepeatBuyersPage() {
  const [buyers, setBuyers] = useState<RepeatBuyer[]>([]);
  const [summary, setSummary] = useState<RepeatBuyersSummary>(defaultSummary);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [windowDays, setWindowDays] = useState(180);
  const [minOrders, setMinOrders] = useState(2);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [countMode, setCountMode] = useState<CountMode>("delivered");
  const [freshness, setFreshness] = useState<ParcelFreshness | null>(null);
  const [resellersOnly, setResellersOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<RepeatBuyerSort>("total_spent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedBuyer, setSelectedBuyer] = useState<RepeatBuyer | null>(null);
  const [truncated, setTruncated] = useState(false);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          window: String(windowDays),
          min_orders: String(minOrders),
          store: storeFilter,
          count_mode: countMode,
        });
        if (forceRefresh) params.set("refresh", "1");

        const res = await fetch(`/api/shopify/repeat-buyers?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        setBuyers(json.buyers || []);
        setSummary(json.summary || defaultSummary);
        setTruncated(Boolean(json.truncated));
        setFreshness(json.freshness ?? null);
        if (json.stores) setStores(json.stores);
        if (json.warnings?.length > 0) {
          setError(`Warning: ${json.warnings.join("; ")}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load repeat buyers");
      } finally {
        setLoading(false);
      }
    },
    [windowDays, minOrders, storeFilter, countMode]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: RepeatBuyerSort) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "customer_name" ? "asc" : "desc");
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...buyers];

    if (resellersOnly) {
      result = result.filter((b) => b.is_reseller_candidate);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.customer_name.toLowerCase().includes(q) ||
          b.phones.some((p) => p.includes(q.replace(/\D/g, ""))) ||
          b.emails.some((e) => e.includes(q)) ||
          b.stores.some((s) => s.toLowerCase().includes(q)) ||
          b.products.some(
            (p) =>
              p.title.toLowerCase().includes(q) ||
              (p.sku || "").toLowerCase().includes(q)
          )
      );
    }

    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // A buyer with a single order has no gap — park them at the end either way.
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (sortKey === "first_order_at" || sortKey === "last_order_at") {
        cmp = new Date(aVal as string).getTime() - new Date(bVal as string).getTime();
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [buyers, resellersOnly, searchQuery, sortKey, sortDir]);

  // One row per buyer, plus the product mix inline — enough to hand a supplier
  // or work through in Sheets without opening every drawer.
  const exportCsv = useCallback(() => {
    const header = [
      "Customer",
      "Phone",
      "Email",
      "Stores",
      "Province",
      "Delivered Orders",
      "RTS",
      "RTS Rate %",
      "Value Returned",
      "In Transit",
      "No Parcel",
      "Cancelled",
      "Units",
      "Total Spent",
      "AOV",
      "Units per Order",
      "Biggest Order Units",
      "First Order",
      "Last Order",
      "Days Since Last",
      "Avg Days Between",
      "COD Orders",
      "Reseller Candidate",
      "Reseller Signals",
      "Products (qty @ avg SRP)",
    ];

    const rows = filteredAndSorted.map((b) => [
      b.customer_name,
      b.phones.join(" / "),
      b.emails.join(" / "),
      b.stores.join(" / "),
      b.province,
      b.delivered_count,
      b.rts_count,
      b.rts_rate_pct,
      b.rts_value,
      b.in_transit_count,
      b.unverified_count,
      b.cancelled_count,
      b.total_units,
      b.total_spent,
      b.avg_order_value,
      b.avg_units_per_order,
      b.largest_order_units,
      b.first_order_at.slice(0, 10),
      b.last_order_at.slice(0, 10),
      b.days_since_last,
      b.avg_days_between,
      b.cod_count,
      b.is_reseller_candidate ? "YES" : "",
      b.reseller_reasons.join("; "),
      b.products
        .map((p) => `${p.title}${p.sku ? ` (${p.sku})` : ""} ×${p.quantity} @ ₱${p.avg_unit_price}`)
        .join("; "),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `repeat-buyers-${windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredAndSorted, windowDays]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Repeat Buyers</h1>
          <p className="text-gray-400 mt-1">
            {countMode === "delivered"
              ? "Customers J&T delivered to more than once — a Shopify order only counts once the parcel lands"
              : "Customers who placed more than one Shopify order — includes parcels that never landed"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={exportCsv}
            disabled={loading || filteredAndSorted.length === 0}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download size={14} />
            Export CSV
          </button>
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

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Where the numbers come from */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg bg-gray-800 p-0.5">
          {(
            [
              { mode: "delivered" as CountMode, label: "Delivered (J&T)" },
              { mode: "all" as CountMode, label: "All Shopify orders" },
            ]
          ).map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setCountMode(opt.mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                countMode === opt.mode
                  ? "bg-white text-gray-900"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {opt.mode === "delivered" && <Truck size={14} />}
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {countMode === "delivered"
            ? "Only parcels J&T handed over count as purchases. Returns, in-transit and cancelled orders stay visible but earn nothing."
            : "Counting every live Shopify order — use this when the J&T upload is behind, not to judge a reseller."}
        </p>
      </div>

      {/* Parcel data coverage — a stale upload reads as "nobody is buying" */}
      {!loading && countMode === "delivered" && (
        <ParcelCoverageNote
          summary={summary}
          freshness={freshness}
          onSwitchMode={() => setCountMode("all")}
        />
      )}

      {/* Window presets */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setWindowDays(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
              windowDays === opt.value
                ? "bg-white text-gray-900"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Filters */}
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
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Minimum:</label>
          <select
            value={minOrders}
            onChange={(e) => setMinOrders(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MIN_ORDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setResellersOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            resellersOnly
              ? "bg-purple-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          <Store size={14} />
          Reseller candidates only
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, email, product or SKU..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="mb-4">
        <RepeatBuyersSummaryCards summary={summary} loading={loading} />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
          <p className="text-gray-500 text-sm">
            Reading {windowDays} days of orders from every store — the long
            windows take a moment.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">
            Showing {filteredAndSorted.length} of {buyers.length} repeat buyers.
            {countMode === "delivered"
              ? " Money and counts come from parcels J&T delivered — returns, in-transit and cancelled orders are excluded."
              : " Money and counts exclude cancelled, voided and refunded orders, but include parcels that may still come back."}
            {truncated && (
              <span className="text-yellow-500">
                {" "}
                Only the {buyers.length} biggest spenders are listed — the cards
                above still count every repeat buyer in the window.
              </span>
            )}
          </p>
          <RepeatBuyersTable
            buyers={filteredAndSorted}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSelectBuyer={setSelectedBuyer}
          />
        </>
      )}

      {selectedBuyer && (
        <RepeatBuyerDetailPanel
          buyer={selectedBuyer}
          onClose={() => setSelectedBuyer(null)}
        />
      )}
    </div>
  );
}

/**
 * The delivered view is only as complete as the J&T upload behind it. A file
 * that hasn't landed makes recent orders look like nobody bought anything, so
 * say how far the parcel data reaches before anyone reads the list as truth.
 */
function ParcelCoverageNote({
  summary,
  freshness,
  onSwitchMode,
}: {
  summary: RepeatBuyersSummary;
  freshness: ParcelFreshness | null;
  onSwitchMode: () => void;
}) {
  const gap = summary.unverified_orders;
  const stale = freshness?.is_stale ?? false;
  if (gap === 0 && !stale) return null;

  const parcelDate = freshness?.latest_parcel_date
    ? new Date(`${freshness.latest_parcel_date}T00:00:00+08:00`).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      )
    : null;

  return (
    <div
      className={`mb-4 p-3 rounded-xl border text-sm flex items-start gap-3 ${
        stale
          ? "bg-yellow-900/20 border-yellow-700/50 text-yellow-300"
          : "bg-gray-800/50 border-gray-700/50 text-gray-400"
      }`}
    >
      <AlertTriangle
        size={16}
        className={`shrink-0 mt-0.5 ${stale ? "text-yellow-400" : "text-gray-500"}`}
      />
      <div>
        <p>
          {summary.parcel_coverage_pct}% of shipped orders in this window have a
          J&T parcel on file
          {gap > 0 && (
            <>
              {" "}
              — {gap.toLocaleString("en-PH")} have none, so they are not counted
              as purchases
            </>
          )}
          .
          {parcelDate && (
            <>
              {" "}
              Parcel data reaches {parcelDate}
              {freshness?.days_behind ? ` (${freshness.days_behind}d behind)` : ""}.
            </>
          )}
        </p>
        {stale && (
          <p className="text-xs mt-1 text-yellow-300/80">
            Upload the latest J&T file on the J&T Dashboard, or{" "}
            <button
              onClick={onSwitchMode}
              className="underline underline-offset-2 cursor-pointer"
            >
              switch to all Shopify orders
            </button>{" "}
            to see the shape in the meantime.
          </p>
        )}
      </div>
    </div>
  );
}
