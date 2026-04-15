"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Package,
  Plus,
  Minus,
  ClipboardCheck,
  BarChart3,
} from "lucide-react";
import type { StockRow, CycleCountEntry } from "@/lib/fulfillment/types";
import { playSuccess, playError } from "@/lib/fulfillment/audio";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";

type Tab = "overview" | "stock_in" | "adjust" | "cycle_count";

interface Location {
  id: number;
  name: string;
  store_name: string;
  active: boolean;
}

interface SessionLogEntry {
  sku: string;
  title: string;
  qty: number;
  newStock: number;
  timestamp: Date;
}

const ADJUST_REASONS = [
  "Damaged",
  "Cycle Count Correction",
  "Found Extra",
  "Customer Return",
  "Other",
];

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Stock Overview", icon: <BarChart3 size={16} /> },
  { key: "stock_in", label: "Stock In", icon: <Plus size={16} /> },
  { key: "adjust", label: "Adjust", icon: <Minus size={16} /> },
  {
    key: "cycle_count",
    label: "Cycle Count",
    icon: <ClipboardCheck size={16} />,
  },
];

export default function StockPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Shared state
  const [inventory, setInventory] = useState<StockRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("ALL");

  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  // ── Fetch inventory ──
  const fetchInventory = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store: storeFilter });
        if (forceRefresh) params.set("refresh", "1");
        const res = await fetch(`/api/shopify/inventory?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        // Map inventory rows to StockRow shape
        const rows: StockRow[] = (json.rows || []).map(
          (r: Record<string, unknown>) => ({
            sku: r.sku || "",
            barcode: r.barcode || null,
            product_title: r.product_title || "",
            variant_title: r.variant_title || null,
            variant_id: r.variant_id || 0,
            inventory_item_id: r.inventory_item_id || 0,
            stock: r.stock ?? r.available ?? 0,
            bin_code: r.bin_code || null,
            zone: r.zone || null,
            store_name: r.store_name || "",
            store_id: r.store_id || "",
          })
        );
        setInventory(rows);
        if (json.stores) setStores(json.stores);
        if (json.warnings?.length > 0) {
          setError(`Warning: ${json.warnings.join("; ")}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load inventory");
      } finally {
        setLoading(false);
      }
    },
    [storeFilter]
  );

  // ── Fetch locations ──
  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify/fulfillment/locations");
      const json = await res.json();
      if (res.ok) setLocations(json.locations || []);
    } catch {
      // Silently fail — locations are supplementary
    }
  }, []);

  useEffect(() => {
    fetchInventory();
    fetchLocations();
  }, [fetchInventory, fetchLocations]);

  // ── Helper: get location for a store ──
  function getLocationForStore(storeName: string): Location | null {
    const match = locations.find(
      (l) => l.store_name === storeName && l.active
    );
    return match || (locations.length > 0 ? locations[0] : null);
  }

  // ── Helper: find product by scan ──
  function findByScan(value: string): StockRow | null {
    const trimmed = value.trim().toLowerCase();
    return (
      inventory.find(
        (r) =>
          r.sku?.toLowerCase() === trimmed ||
          r.barcode?.toLowerCase() === trimmed
      ) || null
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/fulfillment/pick-pack")}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Inventory Management
            </h1>
            <p className="text-gray-400 mt-1">
              Stock in, adjust, and count inventory
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchInventory(true)}
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

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-800/50 rounded-xl p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === tab.key
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-700/50"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <StockOverviewTab
          inventory={inventory}
          stores={stores}
          storeFilter={storeFilter}
          setStoreFilter={setStoreFilter}
          loading={loading}
        />
      )}
      {activeTab === "stock_in" && (
        <StockInTab
          inventory={inventory}
          locations={locations}
          getLocationForStore={getLocationForStore}
          findByScan={findByScan}
          feedback={feedback}
          setFeedback={setFeedback}
          onRefresh={() => fetchInventory(true)}
        />
      )}
      {activeTab === "adjust" && (
        <AdjustTab
          inventory={inventory}
          locations={locations}
          getLocationForStore={getLocationForStore}
          findByScan={findByScan}
          feedback={feedback}
          setFeedback={setFeedback}
          onRefresh={() => fetchInventory(true)}
        />
      )}
      {activeTab === "cycle_count" && (
        <CycleCountTab
          inventory={inventory}
          stores={stores}
          locations={locations}
          getLocationForStore={getLocationForStore}
          feedback={feedback}
          setFeedback={setFeedback}
          onRefresh={() => fetchInventory(true)}
        />
      )}

      {/* Scan feedback overlay */}
      <ScanFeedback
        type={feedback.type}
        message={feedback.message}
        subMessage={feedback.subMessage}
        onDismiss={() => setFeedback({ type: null, message: "" })}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Tab A: Stock Overview
// ════════════════════════════════════════════════════════════════

function StockOverviewTab({
  inventory,
  stores,
  storeFilter,
  setStoreFilter,
  loading,
}: {
  inventory: StockRow[];
  stores: { id: string; name: string }[];
  storeFilter: string;
  setStoreFilter: (v: string) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let rows = [...inventory];
    if (storeFilter !== "ALL") {
      rows = rows.filter((r) => r.store_id === storeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.sku?.toLowerCase().includes(q) ||
          r.product_title?.toLowerCase().includes(q) ||
          r.variant_title?.toLowerCase().includes(q)
      );
    }
    return rows.sort((a, b) => a.stock - b.stock);
  }, [inventory, storeFilter, search]);

  function stockBadge(stock: number) {
    if (stock === 0)
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-300 border border-red-700/50">
          Out of Stock
        </span>
      );
    if (stock < 5)
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/50 text-yellow-300 border border-yellow-700/50">
          Low ({stock})
        </span>
      );
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">
        {stock}
      </span>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
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
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU or product name..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50">
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  SKU
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Product
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Variant
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Stock
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Bin Location
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr
                  key={`${row.store_id}-${row.sku}-${row.variant_id}`}
                  className={`border-b border-gray-800 ${
                    idx % 2 === 0 ? "bg-gray-900/20" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-white font-mono whitespace-nowrap">
                    {row.sku || "---"}
                  </td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                    {row.product_title}
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {row.variant_title || "---"}
                  </td>
                  <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                    {row.stock}
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono whitespace-nowrap">
                    {row.bin_code || "---"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {stockBadge(row.stock)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Package size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">No inventory found</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Tab B: Stock In (scanner-based rapid entry)
// ════════════════════════════════════════════════════════════════

function StockInTab({
  inventory,
  locations,
  getLocationForStore,
  findByScan,
  feedback,
  setFeedback,
  onRefresh,
}: {
  inventory: StockRow[];
  locations: Location[];
  getLocationForStore: (storeName: string) => Location | null;
  findByScan: (value: string) => StockRow | null;
  feedback: { type: "success" | "error" | "warning" | null; message: string };
  setFeedback: (v: {
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }) => void;
  onRefresh: () => void;
}) {
  const [scannedProduct, setScannedProduct] = useState<StockRow | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const qtyRef = useRef<HTMLInputElement>(null);

  function handleStockInScan(value: string) {
    const product = findByScan(value);
    if (!product) {
      playError();
      setFeedback({
        type: "error",
        message: "NOT FOUND",
        subMessage: value.trim(),
      });
      return;
    }
    playSuccess();
    setScannedProduct(product);
    setQuantity(1);
    // Auto-focus quantity input after scan
    setTimeout(() => qtyRef.current?.focus(), 100);
  }

  async function handleStockInSubmit() {
    if (!scannedProduct || submitting) return;

    const loc = getLocationForStore(scannedProduct.store_name);
    if (!loc) {
      playError();
      setFeedback({
        type: "error",
        message: "NO LOCATION",
        subMessage: "No fulfillment location found",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/shopify/inventory-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: scannedProduct.store_name,
          location_id: String(loc.id),
          inventory_item_id: scannedProduct.inventory_item_id,
          mode: "adjust",
          quantity: quantity,
          reason: "Stock In",
          sku: scannedProduct.sku,
          product_title: scannedProduct.product_title,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      playSuccess();
      const newStock = json.new_qty ?? scannedProduct.stock + quantity;

      setSessionLog((prev) => [
        {
          sku: scannedProduct.sku,
          title: `${scannedProduct.product_title}${scannedProduct.variant_title ? ` / ${scannedProduct.variant_title}` : ""}`,
          qty: quantity,
          newStock,
          timestamp: new Date(),
        },
        ...prev,
      ]);

      setFeedback({
        type: "success",
        message: `+${quantity} STOCKED IN`,
        subMessage: `${scannedProduct.sku} → now ${newStock}`,
      });

      // Reset for next scan
      setScannedProduct(null);
      setQuantity(1);
    } catch (e) {
      playError();
      setFeedback({
        type: "error",
        message: "ADJUST FAILED",
        subMessage: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleQtyKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleStockInSubmit();
    }
  }

  return (
    <div>
      {/* Scanner */}
      <div className="mb-4">
        <BarcodeScannerInput
          onScan={handleStockInScan}
          placeholder="Scan item to stock in..."
          autoFocus={!scannedProduct}
        />
      </div>

      {/* Scanned product card */}
      {scannedProduct && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-white font-semibold text-lg">
                {scannedProduct.product_title}
              </p>
              {scannedProduct.variant_title && (
                <p className="text-gray-400 text-sm">
                  {scannedProduct.variant_title}
                </p>
              )}
              <p className="text-gray-500 text-sm font-mono mt-1">
                SKU: {scannedProduct.sku}
              </p>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-xs uppercase">Current Stock</p>
              <p className="text-2xl font-bold text-white">
                {scannedProduct.stock}
              </p>
            </div>
          </div>

          {/* Quantity input */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-400 shrink-0">Qty:</label>
            <input
              ref={qtyRef}
              type="number"
              min={1}
              value={quantity}
              onChange={(e) =>
                setQuantity(Math.max(1, parseInt(e.target.value) || 1))
              }
              onKeyDown={handleQtyKeyDown}
              className="w-24 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-lg text-white font-mono text-center focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleStockInSubmit}
              disabled={submitting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? "Adding..." : `Add +${quantity}`}
            </button>
            <button
              onClick={() => {
                setScannedProduct(null);
                setQuantity(1);
              }}
              className="text-gray-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Session log */}
      {sessionLog.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-2">
            Session Log
          </h3>
          <div className="space-y-1.5">
            {sessionLog.map((entry, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-gray-800/30 border border-gray-700/30 rounded-lg px-4 py-2.5 text-sm"
              >
                <span className="text-gray-300">
                  Added{" "}
                  <span className="text-emerald-400 font-medium">
                    +{entry.qty}
                  </span>{" "}
                  of{" "}
                  <span className="text-white font-mono">{entry.sku}</span>{" "}
                  <span className="text-gray-500">({entry.title})</span>
                </span>
                <span className="text-gray-400 shrink-0 ml-3">
                  → now{" "}
                  <span className="text-white font-medium">
                    {entry.newStock}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!scannedProduct && sessionLog.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Package size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">Scan a barcode to start stocking in</p>
          <p className="text-sm mt-1">
            Items will be added to Shopify inventory
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Tab C: Adjust
// ════════════════════════════════════════════════════════════════

function AdjustTab({
  inventory,
  locations,
  getLocationForStore,
  findByScan,
  feedback,
  setFeedback,
  onRefresh,
}: {
  inventory: StockRow[];
  locations: Location[];
  getLocationForStore: (storeName: string) => Location | null;
  findByScan: (value: string) => StockRow | null;
  feedback: { type: "success" | "error" | "warning" | null; message: string };
  setFeedback: (v: {
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }) => void;
  onRefresh: () => void;
}) {
  const [searchValue, setSearchValue] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<StockRow | null>(null);
  const [mode, setMode] = useState<"set" | "adjust">("set");
  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<StockRow[]>([]);
  const [showResults, setShowResults] = useState(false);

  function handleAdjustScan(value: string) {
    const product = findByScan(value);
    if (!product) {
      playError();
      setFeedback({
        type: "error",
        message: "NOT FOUND",
        subMessage: value.trim(),
      });
      return;
    }
    playSuccess();
    setSelectedProduct(product);
    setQuantity(mode === "set" ? product.stock : 0);
    setShowResults(false);
  }

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (value.trim().length >= 2) {
      const q = value.toLowerCase();
      const results = inventory
        .filter(
          (r) =>
            r.sku?.toLowerCase().includes(q) ||
            r.product_title?.toLowerCase().includes(q)
        )
        .slice(0, 10);
      setSearchResults(results);
      setShowResults(true);
    } else {
      setShowResults(false);
    }
  }

  function selectFromSearch(product: StockRow) {
    setSelectedProduct(product);
    setQuantity(mode === "set" ? product.stock : 0);
    setSearchValue("");
    setShowResults(false);
  }

  async function handleAdjustSubmit() {
    if (!selectedProduct || !reason || submitting) return;

    const loc = getLocationForStore(selectedProduct.store_name);
    if (!loc) {
      playError();
      setFeedback({
        type: "error",
        message: "NO LOCATION",
        subMessage: "No fulfillment location found",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/shopify/inventory-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: selectedProduct.store_name,
          location_id: String(loc.id),
          inventory_item_id: selectedProduct.inventory_item_id,
          mode,
          quantity,
          reason,
          sku: selectedProduct.sku,
          product_title: selectedProduct.product_title,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      playSuccess();
      const newStock = json.new_qty ?? quantity;
      setFeedback({
        type: "success",
        message: mode === "set" ? `SET TO ${newStock}` : `ADJUSTED`,
        subMessage: `${selectedProduct.sku} → now ${newStock}`,
      });

      // Reset
      setSelectedProduct(null);
      setQuantity(0);
      setReason("");
    } catch (e) {
      playError();
      setFeedback({
        type: "error",
        message: "ADJUST FAILED",
        subMessage: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Scanner or search */}
      {!selectedProduct && (
        <div className="space-y-3 mb-4">
          <BarcodeScannerInput
            onScan={handleAdjustScan}
            placeholder="Scan barcode to select product..."
          />
          <div className="relative">
            <div className="flex items-center gap-2">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                type="text"
                value={searchValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Or search by SKU / product name..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {showResults && searchResults.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto">
                {searchResults.map((r) => (
                  <button
                    key={`${r.store_id}-${r.sku}-${r.variant_id}`}
                    onClick={() => selectFromSearch(r)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0 cursor-pointer"
                  >
                    <span className="text-white font-mono text-sm">
                      {r.sku}
                    </span>
                    <span className="text-gray-400 text-sm ml-2">
                      {r.product_title}
                      {r.variant_title ? ` / ${r.variant_title}` : ""}
                    </span>
                    <span className="text-gray-500 text-xs ml-2">
                      Stock: {r.stock}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected product */}
      {selectedProduct && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-white font-semibold text-lg">
                {selectedProduct.product_title}
              </p>
              {selectedProduct.variant_title && (
                <p className="text-gray-400 text-sm">
                  {selectedProduct.variant_title}
                </p>
              )}
              <p className="text-gray-500 text-sm font-mono mt-1">
                SKU: {selectedProduct.sku}
              </p>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-xs uppercase">Current Stock</p>
              <p className="text-2xl font-bold text-white">
                {selectedProduct.stock}
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => {
                setMode("set");
                setQuantity(selectedProduct.stock);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                mode === "set"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              Set to (absolute)
            </button>
            <button
              onClick={() => {
                setMode("adjust");
                setQuantity(0);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                mode === "adjust"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              Adjust by (+/-)
            </button>
          </div>

          {/* Quantity */}
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm text-gray-400 shrink-0">
              {mode === "set" ? "New stock:" : "Change by:"}
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              min={mode === "set" ? 0 : undefined}
              className="w-28 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-lg text-white font-mono text-center focus:border-blue-500 focus:outline-none"
            />
            {mode === "adjust" && (
              <span className="text-gray-400 text-sm">
                → will be{" "}
                <span className="text-white font-medium">
                  {selectedProduct.stock + quantity}
                </span>
              </span>
            )}
          </div>

          {/* Reason */}
          <div className="mb-4">
            <label className="text-sm text-gray-400 block mb-1">
              Reason (required):
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Select a reason...</option>
              {ADJUST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleAdjustSubmit}
              disabled={submitting || !reason}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting
                ? "Adjusting..."
                : mode === "set"
                  ? `Set Stock to ${quantity}`
                  : `Adjust by ${quantity >= 0 ? "+" : ""}${quantity}`}
            </button>
            <button
              onClick={() => {
                setSelectedProduct(null);
                setQuantity(0);
                setReason("");
              }}
              className="text-gray-400 hover:text-white text-sm px-4 py-2.5 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!selectedProduct && (
        <div className="text-center py-16 text-gray-500">
          <Package size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">Scan or search to select a product</p>
          <p className="text-sm mt-1">
            Then set or adjust the stock quantity
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Tab D: Cycle Count
// ════════════════════════════════════════════════════════════════

function CycleCountTab({
  inventory,
  stores,
  locations,
  getLocationForStore,
  feedback,
  setFeedback,
  onRefresh,
}: {
  inventory: StockRow[];
  stores: { id: string; name: string }[];
  locations: Location[];
  getLocationForStore: (storeName: string) => Location | null;
  feedback: { type: "success" | "error" | "warning" | null; message: string };
  setFeedback: (v: {
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }) => void;
  onRefresh: () => void;
}) {
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [zoneFilter, setZoneFilter] = useState("ALL");
  const [countEntries, setCountEntries] = useState<CycleCountEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [applying, setApplying] = useState(false);

  // Available zones from inventory data
  const zones = useMemo(() => {
    const zoneSet = new Set<string>();
    inventory.forEach((r) => {
      if (r.zone) zoneSet.add(r.zone);
    });
    return Array.from(zoneSet).sort();
  }, [inventory]);

  // Filtered inventory for selected store + zone
  const zoneInventory = useMemo(() => {
    let rows = [...inventory];
    if (storeFilter !== "ALL") {
      rows = rows.filter((r) => r.store_id === storeFilter);
    }
    if (zoneFilter !== "ALL") {
      rows = rows.filter((r) => r.zone === zoneFilter);
    }
    return rows.sort((a, b) =>
      (a.bin_code || "ZZZ").localeCompare(b.bin_code || "ZZZ")
    );
  }, [inventory, storeFilter, zoneFilter]);

  function startCount() {
    const entries: CycleCountEntry[] = zoneInventory.map((r) => ({
      sku: r.sku,
      product_title: `${r.product_title}${r.variant_title ? ` / ${r.variant_title}` : ""}`,
      bin_code: r.bin_code,
      expected_qty: r.stock,
      actual_qty: null,
      diff: null,
      inventory_item_id: r.inventory_item_id,
    }));
    setCountEntries(entries);
    setStarted(true);
  }

  function handleScanCount(value: string) {
    const trimmed = value.trim().toLowerCase();
    const idx = countEntries.findIndex(
      (e) => e.sku?.toLowerCase() === trimmed
    );

    // Also check barcode from original inventory
    let matchIdx = idx;
    if (matchIdx === -1) {
      const invMatch = inventory.find(
        (r) => r.barcode?.toLowerCase() === trimmed
      );
      if (invMatch) {
        matchIdx = countEntries.findIndex((e) => e.sku === invMatch.sku);
      }
    }

    if (matchIdx === -1) {
      playError();
      setFeedback({
        type: "error",
        message: "NOT IN ZONE",
        subMessage: value.trim(),
      });
      return;
    }

    playSuccess();
    // Focus the actual count input for this row
    const inputEl = document.getElementById(`actual-${matchIdx}`);
    if (inputEl) {
      (inputEl as HTMLInputElement).focus();
      (inputEl as HTMLInputElement).select();
    }

    setFeedback({
      type: "success",
      message: countEntries[matchIdx].sku,
      subMessage: countEntries[matchIdx].product_title,
    });
  }

  function updateActual(idx: number, value: number | null) {
    setCountEntries((prev) => {
      const next = [...prev];
      const entry = { ...next[idx] };
      entry.actual_qty = value;
      entry.diff = value !== null ? value - entry.expected_qty : null;
      next[idx] = entry;
      return next;
    });
  }

  const discrepancies = useMemo(
    () =>
      countEntries.filter(
        (e) => e.actual_qty !== null && e.diff !== null && e.diff !== 0
      ),
    [countEntries]
  );

  const countedCount = useMemo(
    () => countEntries.filter((e) => e.actual_qty !== null).length,
    [countEntries]
  );

  async function applyCorrections() {
    if (discrepancies.length === 0 || applying) return;

    setApplying(true);
    let successCount = 0;
    let errorCount = 0;

    for (const entry of discrepancies) {
      // Find original row for store info
      const original = inventory.find(
        (r) => r.inventory_item_id === entry.inventory_item_id
      );
      if (!original) {
        errorCount++;
        continue;
      }

      const loc = getLocationForStore(original.store_name);
      if (!loc) {
        errorCount++;
        continue;
      }

      try {
        const res = await fetch("/api/shopify/inventory-adjust", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_name: original.store_name,
            location_id: String(loc.id),
            inventory_item_id: entry.inventory_item_id,
            mode: "set",
            quantity: entry.actual_qty,
            reason: "Cycle Count Correction",
            sku: entry.sku,
            product_title: entry.product_title,
          }),
        });
        if (res.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setApplying(false);

    if (errorCount === 0) {
      playSuccess();
      setFeedback({
        type: "success",
        message: "CORRECTIONS APPLIED",
        subMessage: `${successCount} item${successCount !== 1 ? "s" : ""} updated`,
      });
      // Reset
      setStarted(false);
      setCountEntries([]);
      onRefresh();
    } else {
      playError();
      setFeedback({
        type: "error",
        message: "PARTIAL FAILURE",
        subMessage: `${successCount} ok, ${errorCount} failed`,
      });
    }
  }

  if (!started) {
    return (
      <div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 mb-4">
          <h3 className="text-white font-semibold mb-4">
            Start a Cycle Count
          </h3>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Store:</label>
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="text-sm text-gray-400">Zone:</label>
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Zones</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-gray-400 text-sm mb-4">
            {zoneInventory.length} product
            {zoneInventory.length !== 1 ? "s" : ""} in selected zone
          </p>
          <button
            onClick={startCount}
            disabled={zoneInventory.length === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            Start Counting ({zoneInventory.length} items)
          </button>
        </div>

        <div className="text-center py-12 text-gray-500">
          <ClipboardCheck size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">Select a store and zone to begin</p>
          <p className="text-sm mt-1">
            Count actual inventory and reconcile with expected stock
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Scanner */}
      <div className="mb-4">
        <BarcodeScannerInput
          onScan={handleScanCount}
          placeholder="Scan item to jump to it..."
        />
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-gray-400 text-sm">
          {countedCount}/{countEntries.length} items counted
          {discrepancies.length > 0 && (
            <span className="text-yellow-400 ml-2">
              ({discrepancies.length} discrepanc
              {discrepancies.length === 1 ? "y" : "ies"})
            </span>
          )}
        </p>
        <button
          onClick={() => {
            setStarted(false);
            setCountEntries([]);
          }}
          className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Cancel Count
        </button>
      </div>

      {/* Count table */}
      <div className="overflow-x-auto rounded-xl border border-gray-700/50 mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800/50">
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                SKU
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Product
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Bin
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-center whitespace-nowrap">
                Expected
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-center whitespace-nowrap">
                Actual
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-center whitespace-nowrap">
                Diff
              </th>
            </tr>
          </thead>
          <tbody>
            {countEntries.map((entry, idx) => {
              const hasDiff =
                entry.actual_qty !== null &&
                entry.diff !== null &&
                entry.diff !== 0;
              return (
                <tr
                  key={`${entry.sku}-${idx}`}
                  className={`border-b border-gray-800 ${
                    hasDiff
                      ? "bg-red-900/10"
                      : entry.actual_qty !== null
                        ? "bg-emerald-900/10"
                        : idx % 2 === 0
                          ? "bg-gray-900/20"
                          : ""
                  }`}
                >
                  <td className="px-4 py-3 text-white font-mono whitespace-nowrap">
                    {entry.sku}
                  </td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap max-w-[200px] truncate">
                    {entry.product_title}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono whitespace-nowrap">
                    {entry.bin_code || "---"}
                  </td>
                  <td className="px-4 py-3 text-white font-medium text-center whitespace-nowrap">
                    {entry.expected_qty}
                  </td>
                  <td className="px-4 py-2 text-center whitespace-nowrap">
                    <input
                      id={`actual-${idx}`}
                      type="number"
                      min={0}
                      value={entry.actual_qty ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateActual(
                          idx,
                          val === "" ? null : parseInt(val) || 0
                        );
                      }}
                      placeholder="--"
                      className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white font-mono text-center focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  <td
                    className={`px-4 py-3 font-medium text-center whitespace-nowrap ${
                      entry.diff === null
                        ? "text-gray-500"
                        : entry.diff === 0
                          ? "text-emerald-400"
                          : "text-red-400"
                    }`}
                  >
                    {entry.diff === null
                      ? "--"
                      : entry.diff > 0
                        ? `+${entry.diff}`
                        : entry.diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Apply corrections */}
      {discrepancies.length > 0 && (
        <button
          onClick={applyCorrections}
          disabled={applying}
          className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
        >
          {applying
            ? "Applying corrections..."
            : `Apply Corrections (${discrepancies.length} item${discrepancies.length !== 1 ? "s" : ""})`}
        </button>
      )}

      {countedCount === countEntries.length &&
        countEntries.length > 0 &&
        discrepancies.length === 0 && (
          <div className="text-center py-6">
            <p className="text-emerald-400 font-semibold text-lg">
              All items match expected stock
            </p>
          </div>
        )}
    </div>
  );
}
