"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Download,
  AlertTriangle,
  DollarSign,
  Package,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import type { AdSpendRow } from "@/app/api/compliance/ad-spend/route";
import type {
  MovementRow,
  SalesOutRow,
  SnapshotRow,
} from "@/app/api/compliance/stock-movement/route";
import { exportAdSpend, exportStockMovement } from "@/lib/compliance/export-excel";
import type { ComplianceDateFilter } from "@/lib/compliance/date-range";

const DATE_PRESETS: { label: string; value: ComplianceDateFilter }[] = [
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Year", value: "this_year" },
  { label: "Custom", value: "custom" },
];

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-PH");

type Tab = "ad_spend" | "stock";

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>("ad_spend");
  const [dateFilter, setDateFilter] = useState<ComplianceDateFilter>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Ad spend state
  const [adRows, setAdRows] = useState<AdSpendRow[]>([]);
  const [adSummary, setAdSummary] = useState<{
    total_spend: number;
    row_count: number;
    date_from: string;
    date_to: string;
  } | null>(null);
  const [adLoading, setAdLoading] = useState(false);
  const [adError, setAdError] = useState<string | null>(null);
  const [adWarnings, setAdWarnings] = useState<string[]>([]);

  // Stock state
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [salesOut, setSalesOut] = useState<SalesOutRow[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotRow[]>([]);
  const [stockSummary, setStockSummary] = useState<{
    movement_count: number;
    net_adjusted_units: number;
    total_units_sold: number;
    snapshot_skus: number;
    total_units_on_hand: number;
    date_from: string;
    date_to: string;
  } | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockWarnings, setStockWarnings] = useState<string[]>([]);

  const dateParams = useCallback(() => {
    const p = new URLSearchParams({ date_filter: dateFilter });
    if (dateFilter === "custom") {
      if (customFrom) p.set("date_from", customFrom);
      if (customTo) p.set("date_to", customTo);
    }
    return p;
  }, [dateFilter, customFrom, customTo]);

  const fetchAdSpend = useCallback(async () => {
    if (dateFilter === "custom" && (!customFrom || !customTo)) return;
    setAdLoading(true);
    setAdError(null);
    try {
      const res = await fetch(`/api/compliance/ad-spend?${dateParams()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load ad spend");
      setAdRows(json.rows || []);
      setAdSummary(json.summary || null);
      setAdWarnings(json.warnings || []);
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed to load ad spend");
      setAdRows([]);
      setAdSummary(null);
    } finally {
      setAdLoading(false);
    }
  }, [dateFilter, customFrom, customTo, dateParams]);

  const fetchStock = useCallback(async () => {
    if (dateFilter === "custom" && (!customFrom || !customTo)) return;
    setStockLoading(true);
    setStockError(null);
    try {
      const p = dateParams();
      p.set("store", storeFilter);
      const res = await fetch(`/api/compliance/stock-movement?${p}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load stock movement");
      setMovements(json.movements || []);
      setSalesOut(json.salesOut || []);
      setSnapshot(json.snapshot || []);
      setStockSummary(json.summary || null);
      if (json.stores) setStores(json.stores);
      setStockWarnings(json.warnings || []);
    } catch (e) {
      setStockError(e instanceof Error ? e.message : "Failed to load stock movement");
      setMovements([]);
      setSalesOut([]);
      setSnapshot([]);
      setStockSummary(null);
    } finally {
      setStockLoading(false);
    }
  }, [dateFilter, customFrom, customTo, storeFilter, dateParams]);

  useEffect(() => {
    if (tab === "ad_spend") fetchAdSpend();
    else fetchStock();
  }, [tab, fetchAdSpend, fetchStock]);

  const handleExportAd = () => {
    if (adRows.length === 0) {
      toast.error("Walang data na i-e-export. Subukan ang ibang date range.");
      return;
    }
    exportAdSpend(adRows, {
      from: adSummary?.date_from || "",
      to: adSummary?.date_to || "",
    });
    toast.success("Na-download ang Excel file.");
  };

  const handleExportStock = () => {
    if (movements.length === 0 && salesOut.length === 0 && snapshot.length === 0) {
      toast.error("Walang data na i-e-export.");
      return;
    }
    exportStockMovement(
      { movements, salesOut, snapshot },
      { from: stockSummary?.date_from || "", to: stockSummary?.date_to || "" }
    );
    toast.success("Na-download ang Excel file (3 sheets).");
  };

  const loading = tab === "ad_spend" ? adLoading : stockLoading;
  const refresh = () => (tab === "ad_spend" ? fetchAdSpend() : fetchStock());

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet size={24} className="text-gray-400" />
            Compliance
          </h1>
          <p className="text-gray-400 mt-1">
            Accountant extracts — FB ad spend &amp; stock movement records
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b border-gray-800">
        <button
          onClick={() => setTab("ad_spend")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === "ad_spend"
              ? "border-white text-white"
              : "border-transparent text-gray-400 hover:text-white"
          }`}
        >
          <DollarSign size={16} />
          Ad Spend
        </button>
        <button
          onClick={() => setTab("stock")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === "stock"
              ? "border-white text-white"
              : "border-transparent text-gray-400 hover:text-white"
          }`}
        >
          <Package size={16} />
          Stock Movement
        </button>
      </div>

      {/* Filters */}
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

      {tab === "stock" && stores.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
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
      )}

      {/* ============ AD SPEND TAB ============ */}
      {tab === "ad_spend" && (
        <>
          {adError && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
              {adError}
            </div>
          )}

          {adWarnings.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-xl text-yellow-300 text-sm">
              <p className="font-medium flex items-center gap-2">
                <AlertTriangle size={14} /> Some accounts had issues:
              </p>
              <ul className="mt-1 list-disc list-inside text-yellow-400/80">
                {adWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <SummaryCard
              label="Total Ad Spend"
              value={adSummary ? peso(adSummary.total_spend) : "—"}
              loading={adLoading}
            />
            <SummaryCard
              label="Line Items"
              value={adSummary ? num(adSummary.row_count) : "—"}
              loading={adLoading}
            />
            <SummaryCard
              label="Date Range"
              value={adSummary ? `${adSummary.date_from} → ${adSummary.date_to}` : "—"}
              loading={adLoading}
              small
            />
          </div>

          <div className="flex justify-end mb-3">
            <button
              onClick={handleExportAd}
              disabled={adLoading || adRows.length === 0}
              className="flex items-center gap-2 bg-white text-gray-900 font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download size={16} />
              Export to Excel
            </button>
          </div>

          {adLoading ? (
            <LoadingBlock />
          ) : (
            <PreviewTable
              headers={["Date", "Account", "Campaign", "Ad Set", "Spend"]}
              rows={adRows.slice(0, 50).map((r) => [
                r.date,
                r.account,
                r.campaign,
                r.adset,
                peso(r.spend),
              ])}
              totalRows={adRows.length}
              emptyMsg="Walang ad spend sa date range na 'to."
            />
          )}
        </>
      )}

      {/* ============ STOCK TAB ============ */}
      {tab === "stock" && (
        <>
          {stockError && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
              {stockError}
            </div>
          )}

          <div className="mb-4 p-3 bg-blue-900/15 border border-blue-700/30 rounded-xl text-blue-200/90 text-xs leading-relaxed">
            <p className="font-medium text-blue-200 mb-1">Paano binuo ang record na ito:</p>
            Ang Shopify ay walang raw inventory-history API, kaya ang stock movement ay
            galing sa: <strong>Sales Out</strong> (orders) + <strong>Stock Adjustments</strong>{" "}
            (RTS restocks &amp; manual adjusts na dumaan sa dashboard) + kasalukuyang{" "}
            <strong>Current Stock</strong> snapshot. Tumpak ito basta lahat ng stock changes ay
            dito sa dashboard dumaraan, hindi direkta sa Shopify admin.
          </div>

          {stockWarnings.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-xl text-yellow-300 text-sm">
              <p className="font-medium flex items-center gap-2">
                <AlertTriangle size={14} /> Some stores had issues:
              </p>
              <ul className="mt-1 list-disc list-inside text-yellow-400/80">
                {stockWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryCard
              label="Units Sold (Out)"
              value={stockSummary ? num(stockSummary.total_units_sold) : "—"}
              loading={stockLoading}
            />
            <SummaryCard
              label="Adjustments"
              value={stockSummary ? num(stockSummary.movement_count) : "—"}
              loading={stockLoading}
            />
            <SummaryCard
              label="Net Adjusted Units"
              value={stockSummary ? num(stockSummary.net_adjusted_units) : "—"}
              loading={stockLoading}
            />
            <SummaryCard
              label="On-Hand (Current)"
              value={stockSummary ? num(stockSummary.total_units_on_hand) : "—"}
              loading={stockLoading}
            />
          </div>

          <div className="flex justify-end mb-3">
            <button
              onClick={handleExportStock}
              disabled={
                stockLoading ||
                (movements.length === 0 && salesOut.length === 0 && snapshot.length === 0)
              }
              className="flex items-center gap-2 bg-white text-gray-900 font-medium text-sm px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download size={16} />
              Export to Excel (3 sheets)
            </button>
          </div>

          {stockLoading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-2">
                  Sales Out <span className="text-gray-500 font-normal">(units sold)</span>
                </h3>
                <PreviewTable
                  headers={["Date", "Store", "SKU", "Product", "Units"]}
                  rows={salesOut.slice(0, 30).map((r) => [
                    r.date,
                    r.store,
                    r.sku,
                    r.product,
                    num(r.units_sold),
                  ])}
                  totalRows={salesOut.length}
                  emptyMsg="Walang sales sa range."
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-2">
                  Stock Adjustments{" "}
                  <span className="text-gray-500 font-normal">(restocks &amp; manual)</span>
                </h3>
                <PreviewTable
                  headers={["Date", "Store", "SKU", "Type", "Change", "By"]}
                  rows={movements.slice(0, 30).map((r) => [
                    r.date,
                    r.store,
                    r.sku,
                    r.type,
                    r.change_qty === null ? "—" : num(r.change_qty),
                    r.performed_by,
                  ])}
                  totalRows={movements.length}
                  emptyMsg="Walang adjustments sa range."
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-2">
                  Current Stock <span className="text-gray-500 font-normal">(live snapshot)</span>
                </h3>
                <PreviewTable
                  headers={["Store", "SKU", "Product", "Variant", "On-Hand"]}
                  rows={snapshot.slice(0, 30).map((r) => [
                    r.store,
                    r.sku,
                    r.product,
                    r.variant,
                    num(r.current_qty),
                  ])}
                  totalRows={snapshot.length}
                  emptyMsg="Walang stock data."
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  loading,
  small,
}: {
  label: string;
  value: string;
  loading: boolean;
  small?: boolean;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="h-6 mt-1.5 w-20 bg-gray-700 rounded animate-pulse" />
      ) : (
        <p className={`mt-1 font-bold text-white ${small ? "text-sm" : "text-xl"}`}>
          {value}
        </p>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw size={24} className="animate-spin text-gray-400" />
    </div>
  );
}

function PreviewTable({
  headers,
  rows,
  totalRows,
  emptyMsg,
}: {
  headers: string[];
  rows: (string | number)[][];
  totalRows: number;
  emptyMsg: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center border border-gray-800 rounded-xl">
        {emptyMsg}
      </div>
    );
  }
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/60">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="text-left text-gray-400 font-medium px-3 py-2 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-white/5">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-gray-300 whitespace-nowrap max-w-[240px] truncate">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > rows.length && (
        <div className="px-3 py-2 text-xs text-gray-500 bg-gray-800/30 border-t border-gray-800">
          Preview: {rows.length} of {num(totalRows)} rows. I-export para makita lahat.
        </div>
      )}
    </div>
  );
}
