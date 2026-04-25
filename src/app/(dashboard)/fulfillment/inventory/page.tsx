"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, PackagePlus } from "lucide-react";
import type {
  InventoryRow,
  InventoryProduct,
  InventorySummary,
  InventoryStockFilter,
} from "@/lib/shopify/types";
import { InventorySummaryCards } from "@/components/inventory/inventory-summary-cards";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { ProductDetailPanel } from "@/components/inventory/product-detail-panel";
import { RtsBatchModal } from "@/components/inventory/rts-batch-modal";

const STOCK_OPTIONS: { label: string; value: InventoryStockFilter }[] = [
  { label: "All", value: "all" },
  { label: "In Stock (10+)", value: "in_stock" },
  { label: "Low Stock (1-9)", value: "low_stock" },
  { label: "Out of Stock", value: "out_of_stock" },
];

const defaultSummary: InventorySummary = {
  total_products: 0,
  total_variants: 0,
  out_of_stock_count: 0,
  low_stock_count: 0,
  total_units: 0,
};

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [summary, setSummary] = useState<InventorySummary>(defaultSummary);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState<InventoryStockFilter>("all");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState("stock");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [role, setRole] = useState<string>("");
  const [rtsOpen, setRtsOpen] = useState(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        store: storeFilter,
      });
      if (forceRefresh) params.set("refresh", "1");

      const res = await fetch(`/api/shopify/inventory?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      setRows(json.rows || []);
      setProducts(json.products || []);
      setSummary(json.summary || defaultSummary);
      if (json.stores) setStores(json.stores);
      if (json.productTypes) setProductTypes(json.productTypes);
      if (json.role) setRole(json.role);
      // Show warnings from failed stores
      if (json.warnings?.length > 0) {
        setError(`Warning: ${json.warnings.join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...rows];

    // Stock status filter
    if (stockFilter !== "all") {
      result = result.filter((r) => r.stock_status === stockFilter);
    }

    // Product type filter
    if (typeFilter !== "ALL") {
      result = result.filter((r) => r.product_type === typeFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.product_title.toLowerCase().includes(q) ||
          r.variant_title.toLowerCase().includes(q) ||
          (r.sku && r.sku.toLowerCase().includes(q))
      );
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortKey as keyof InventoryRow];
      const bVal = b[sortKey as keyof InventoryRow];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        if (sortKey === "price") {
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
  }, [rows, stockFilter, typeFilter, searchQuery, sortKey, sortDir]);

  const selectedProduct = useMemo(() => {
    if (selectedProductId === null) return null;
    return products.find((p) => p.id === selectedProductId) || null;
  }, [selectedProductId, products]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventory</h1>
          <p className="text-gray-400 mt-1">
            Stock levels across {stores.length} store
            {stores.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(role === "admin" || role === "fulfillment") && (
            <button
              onClick={() => setRtsOpen(true)}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer"
            >
              <PackagePlus size={14} />
              RTS Return
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

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
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
          <label className="text-sm text-gray-400">Stock:</label>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as InventoryStockFilter)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STOCK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Types</option>
            {productTypes.map((t) => (
              <option key={t} value={t}>
                {t}
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
            placeholder="Search product, variant, or SKU..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-4">
        <InventorySummaryCards summary={summary} loading={loading} />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Inventory Table */}
      {!loading && (
        <InventoryTable
          rows={filteredAndSorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          isAdmin={role === "admin"}
          onSelectProduct={setSelectedProductId}
        />
      )}

      {/* Product Detail Panel */}
      {selectedProduct && (
        <ProductDetailPanel
          product={selectedProduct}
          isAdmin={role === "admin"}
          onClose={() => setSelectedProductId(null)}
        />
      )}

      {/* RTS Return modal */}
      <RtsBatchModal
        open={rtsOpen}
        onClose={() => setRtsOpen(false)}
        onCompleted={() => fetchData(true)}
      />
    </div>
  );
}
