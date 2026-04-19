"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import type {
  ShopifyOrder,
  OrderDateFilter,
  FulfillmentFilter,
  PaymentTypeFilter,
  OrdersSummary,
} from "@/lib/shopify/types";
import { OrdersSummaryCards } from "@/components/orders/orders-summary-cards";
import { OrdersTable } from "@/components/orders/orders-table";
import { OrderDetailPanel } from "@/components/orders/order-detail-panel";

const DATE_PRESETS: { label: string; value: OrderDateFilter }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "This Month", value: "this_month" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "Custom", value: "custom" },
];

const STATUS_OPTIONS: { label: string; value: FulfillmentFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unfulfilled", value: "unfulfilled" },
  { label: "Aging (3d+)", value: "aging" },
  { label: "Fulfilled", value: "fulfilled" },
  { label: "Partial", value: "partial" },
  { label: "Cancelled / Voided", value: "cancelled" },
];

const PAYMENT_OPTIONS: { label: string; value: PaymentTypeFilter }[] = [
  { label: "All", value: "all" },
  { label: "COD", value: "cod" },
  { label: "Prepaid", value: "prepaid" },
];

const defaultSummary: OrdersSummary = {
  total_orders: 0,
  total_revenue: 0,
  unfulfilled_count: 0,
  fulfilled_count: 0,
  cancelled_count: 0,
  partially_fulfilled_count: 0,
  avg_fulfillment_hours: null,
  cod_count: 0,
  prepaid_count: 0,
  aging_warning_count: 0,
  aging_danger_count: 0,
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [summary, setSummary] = useState<OrdersSummary>(defaultSummary);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<OrderDateFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<FulfillmentFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentTypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [role, setRole] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date_filter: dateFilter,
        store: storeFilter,
        status: statusFilter,
      });
      if (forceRefresh) params.set("refresh", "1");
      if (dateFilter === "custom" && customFrom) {
        params.set("date_from", `${customFrom}T00:00:00+08:00`);
      }
      if (dateFilter === "custom" && customTo) {
        params.set("date_to", `${customTo}T23:59:59+08:00`);
      }

      const res = await fetch(`/api/shopify/orders?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      setOrders(json.orders || []);
      setSummary(json.summary || defaultSummary);
      if (json.stores) setStores(json.stores);
      if (json.role) setRole(json.role);
      // Show warnings from failed stores
      if (json.warnings?.length > 0) {
        setError(`Warning: ${json.warnings.join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [dateFilter, storeFilter, statusFilter, customFrom, customTo]);

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

  const filteredAndSorted = useMemo(() => {
    let result = [...orders];

    // Client-side payment type filter (is_cod is computed from Shopify gateway)
    if (paymentFilter === "cod") {
      result = result.filter((o) => o.is_cod);
    } else if (paymentFilter === "prepaid") {
      result = result.filter((o) => !o.is_cod);
    }

    // Client-side search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortKey as keyof ShopifyOrder];
      const bVal = b[sortKey as keyof ShopifyOrder];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        // Check if it looks like a number (total_price)
        if (sortKey === "total_price") {
          cmp = parseFloat(aVal) - parseFloat(bVal);
        } else {
          cmp = aVal.localeCompare(bVal);
        }
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [orders, paymentFilter, searchQuery, sortKey, sortDir]);

  // "Needs Attention" shortcut: broaden date window to last 30d and filter
  // to aging unfulfilled orders. The VA can one-click triage old orders
  // without having to re-pick date + status filters separately.
  const showNeedsAttention = useCallback(() => {
    setDateFilter("last_30d");
    setStatusFilter("aging");
    setPaymentFilter("all");
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Orders & Parcels</h1>
          <p className="text-gray-400 mt-1">
            Shopify orders across {stores.length} store
            {stores.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
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

      {/* Filters Row */}
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
          <label className="text-sm text-gray-400">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as FulfillmentFilter)
            }
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Payment:</label>
          <select
            value={paymentFilter}
            onChange={(e) =>
              setPaymentFilter(e.target.value as PaymentTypeFilter)
            }
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PAYMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search order # or customer..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-4">
        <OrdersSummaryCards summary={summary} loading={loading} isAdmin={role === "admin"} />
      </div>

      {/* Aging Danger Banner — click to show all aging orders across last 30d */}
      {!loading && summary.aging_danger_count > 0 && (
        <button
          type="button"
          onClick={showNeedsAttention}
          className="w-full mb-4 p-4 bg-red-900/20 border border-red-700/50 hover:bg-red-900/30 rounded-xl flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-400 shrink-0" />
            <p className="text-red-300 text-sm font-medium">
              {summary.aging_danger_count} order
              {summary.aging_danger_count !== 1 ? "s" : ""} unfulfilled for 5+
              days!
            </p>
          </div>
          <span className="text-xs text-red-300/80 underline underline-offset-2">
            Review now →
          </span>
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Orders Table */}
      {!loading && (
        <OrdersTable
          orders={filteredAndSorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          isAdmin={role === "admin"}
          onSelectOrder={setSelectedOrder}
        />
      )}

      {/* Order Detail Panel */}
      {selectedOrder && (
        <OrderDetailPanel
          order={selectedOrder}
          isAdmin={role === "admin"}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}
