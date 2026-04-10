"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Package,
  CheckCircle,
  Truck,
  RotateCcw,
  XCircle,
  AlertTriangle,
  Upload,
  ChevronDown,
  ChevronUp,
  DollarSign,
} from "lucide-react";
import type { JtDelivery, JtClassification } from "@/lib/profit/types";
import { JtUploader } from "@/components/profit/jt-uploader";

interface JtSummary {
  total: number;
  delivered: number;
  returned: number;
  in_transit: number;
  for_return: number;
  aged: number;
  total_cod: number;
  total_shipping: number;
}

const defaultSummary: JtSummary = {
  total: 0,
  delivered: 0,
  returned: 0,
  in_transit: 0,
  for_return: 0,
  aged: 0,
  total_cod: 0,
  total_shipping: 0,
};

const CLASSIFICATION_OPTIONS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Delivered", value: "Delivered" },
  { label: "In Transit", value: "In Transit" },
  { label: "Returned", value: "Returned" },
  { label: "For Return", value: "For Return" },
  { label: "Returned (Aged)", value: "Returned (Aged)" },
];

function formatCurrency(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

interface StoreBreakdown {
  store: string;
  total: number;
  delivered: number;
  returned: number;
  aged: number;
  in_transit: number;
  delivery_rate: number;
  cod_collected: number;
}

export default function JtDashboardPage() {
  const [deliveries, setDeliveries] = useState<JtDelivery[]>([]);
  const [summary, setSummary] = useState<JtSummary>(defaultSummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Upload section
  const [showUploader, setShowUploader] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ store: storeFilter });
      if (classificationFilter !== "all") {
        params.set("classification", classificationFilter);
      }
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await fetch(`/api/profit/jt-data?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load J&T data");

      setDeliveries(json.deliveries || []);
      setSummary(json.summary || defaultSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load J&T data");
    } finally {
      setLoading(false);
    }
  }, [storeFilter, classificationFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Unique stores from deliveries
  const storeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of deliveries) {
      if (d.store_name) names.add(d.store_name);
    }
    return Array.from(names).sort();
  }, [deliveries]);

  // Delivery rate
  const deliveryRate = useMemo(() => {
    // Settled = delivered + returned + for_return + aged (same as Apps Script)
    const settled = summary.delivered + summary.returned + summary.for_return + summary.aged;
    return settled > 0 ? ((summary.delivered / settled) * 100).toFixed(1) : "0.0";
  }, [summary]);

  // Store breakdown
  const storeBreakdown = useMemo((): StoreBreakdown[] => {
    const map = new Map<string, StoreBreakdown>();
    for (const d of deliveries) {
      const store = d.store_name || "Unknown";
      let entry = map.get(store);
      if (!entry) {
        entry = { store, total: 0, delivered: 0, returned: 0, aged: 0, in_transit: 0, delivery_rate: 0, cod_collected: 0 };
        map.set(store, entry);
      }
      entry.total++;
      if (d.classification === "Delivered") {
        entry.delivered++;
        entry.cod_collected += d.cod_amount;
      } else if (d.classification === "Returned" || d.classification === "For Return") {
        entry.returned++;
      } else if (d.classification === "Returned (Aged)") {
        entry.aged++;
      } else {
        entry.in_transit++;
      }
    }
    for (const entry of map.values()) {
      // Settled = delivered + returned + for_return + aged (same as Apps Script)
      const settled = entry.delivered + entry.returned + entry.aged;
      entry.delivery_rate = settled > 0 ? (entry.delivered / settled) * 100 : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [deliveries]);

  // RTS deliveries
  const rtsDeliveries = useMemo(() => {
    const rtsClassifications: JtClassification[] = ["Returned", "For Return", "Returned (Aged)"];
    return deliveries
      .filter((d) => rtsClassifications.includes(d.classification))
      .sort((a, b) => (b.days_since_submit ?? 0) - (a.days_since_submit ?? 0));
  }, [deliveries]);

  function rateColorClass(rate: number): string {
    if (rate > 80) return "text-green-400";
    if (rate >= 60) return "text-yellow-400";
    return "text-red-400";
  }

  function classificationRowClass(classification: JtClassification): string {
    switch (classification) {
      case "Returned":
        return "text-red-400";
      case "For Return":
        return "text-orange-400";
      case "Returned (Aged)":
        return "text-yellow-400";
      default:
        return "text-gray-300";
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">J&T Dashboard</h1>
          <p className="text-gray-400 mt-1">Delivery tracking & RTS monitoring</p>
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

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Store:</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Stores</option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Classification:</label>
          <select
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CLASSIFICATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {/* Total Parcels */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package size={16} className="text-blue-400" />
            <span className="text-xs text-gray-400 font-medium">Total Parcels</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.total.toLocaleString()}
          </p>
        </div>

        {/* Delivered */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-green-400" />
            <span className="text-xs text-gray-400 font-medium">Delivered</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.delivered.toLocaleString()}
          </p>
          <p className="text-xs text-green-400 mt-1">{loading ? "" : `${deliveryRate}% rate`}</p>
        </div>

        {/* In Transit */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Truck size={16} className="text-blue-400" />
            <span className="text-xs text-gray-400 font-medium">In Transit</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.in_transit.toLocaleString()}
          </p>
        </div>

        {/* For Return */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw size={16} className="text-orange-400" />
            <span className="text-xs text-gray-400 font-medium">For Return</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.for_return.toLocaleString()}
          </p>
        </div>

        {/* Returned */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={16} className="text-red-400" />
            <span className="text-xs text-gray-400 font-medium">Returned</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.returned.toLocaleString()}
          </p>
        </div>

        {/* Returned (Aged) */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            <span className="text-xs text-gray-400 font-medium">Returned (Aged)</span>
          </div>
          <p className="text-xl font-bold text-white">
            {loading ? "-" : summary.aged.toLocaleString()}
          </p>
        </div>

        {/* COD Collected */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-green-400" />
            <span className="text-xs text-gray-400 font-medium">COD Collected</span>
          </div>
          <p className="text-lg font-bold text-white">
            {loading ? "-" : formatCurrency(summary.total_cod)}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Store Breakdown Table */}
      {!loading && storeBreakdown.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-white">Store Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-400 text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Store</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium">Delivered</th>
                  <th className="text-right px-4 py-2.5 font-medium">Returned</th>
                  <th className="text-right px-4 py-2.5 font-medium">Aged</th>
                  <th className="text-right px-4 py-2.5 font-medium">In Transit</th>
                  <th className="text-right px-4 py-2.5 font-medium">Delivery Rate</th>
                  <th className="text-right px-4 py-2.5 font-medium">COD Collected</th>
                </tr>
              </thead>
              <tbody>
                {storeBreakdown.map((row) => (
                  <tr key={row.store} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                    <td className="px-4 py-2.5 text-white font-medium">{row.store}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300">{row.total}</td>
                    <td className="px-4 py-2.5 text-right text-green-400">{row.delivered}</td>
                    <td className="px-4 py-2.5 text-right text-red-400">{row.returned}</td>
                    <td className="px-4 py-2.5 text-right text-yellow-400">{row.aged}</td>
                    <td className="px-4 py-2.5 text-right text-blue-400">{row.in_transit}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${rateColorClass(row.delivery_rate)}`}>
                      {row.delivery_rate.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-green-400">{formatCurrency(row.cod_collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RTS Table */}
      {!loading && rtsDeliveries.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-white">
              RTS (Return to Sender){" "}
              <span className="text-gray-400 font-normal">— {rtsDeliveries.length} parcels</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-400 text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Waybill</th>
                  <th className="text-left px-4 py-2.5 font-medium">Store</th>
                  <th className="text-left px-4 py-2.5 font-medium">Receiver</th>
                  <th className="text-left px-4 py-2.5 font-medium">Province</th>
                  <th className="text-left px-4 py-2.5 font-medium">City</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Days</th>
                  <th className="text-left px-4 py-2.5 font-medium">RTS Reason</th>
                  <th className="text-right px-4 py-2.5 font-medium">COD</th>
                  <th className="text-left px-4 py-2.5 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rtsDeliveries.map((d) => (
                  <tr key={d.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                    <td className="px-4 py-2.5 text-white font-mono text-xs">{d.waybill}</td>
                    <td className="px-4 py-2.5 text-gray-300">{d.store_name || "-"}</td>
                    <td className="px-4 py-2.5 text-gray-300">{d.receiver || "-"}</td>
                    <td className="px-4 py-2.5 text-gray-300">{d.province || "-"}</td>
                    <td className="px-4 py-2.5 text-gray-300">{d.city || "-"}</td>
                    <td className={`px-4 py-2.5 font-medium ${classificationRowClass(d.classification)}`}>
                      {d.classification}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300">
                      {d.days_since_submit !== null ? d.days_since_submit : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 max-w-[200px] truncate" title={d.rts_reason || ""}>
                      {d.rts_reason || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300">
                      {d.cod_amount > 0 ? formatCurrency(d.cod_amount) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(d.submission_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && deliveries.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Package size={40} className="mx-auto mb-3 opacity-50" />
          <p>No deliveries found for the selected filters.</p>
        </div>
      )}

      {/* Upload Section */}
      <div className="mt-6">
        <button
          onClick={() => setShowUploader((v) => !v)}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer mb-4"
        >
          <Upload size={14} />
          {showUploader ? "Hide J&T Upload" : "Upload J&T Data"}
          {showUploader ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showUploader && <JtUploader />}
      </div>
    </div>
  );
}
