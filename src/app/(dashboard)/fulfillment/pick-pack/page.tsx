"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { UnfulfilledOrder } from "@/lib/fulfillment/types";
import { OrdersQueue } from "@/components/fulfillment/orders-queue";

interface InventoryRow {
  sku: string;
  stock: number;
  store_name: string;
}

export default function PickPackPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<UnfulfilledOrder[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("ALL");

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        // Fetch orders and inventory in parallel
        const [ordersRes, inventoryRes] = await Promise.all([
          fetch(`/api/shopify/fulfillment?store=${storeFilter}${forceRefresh ? "&refresh=1" : ""}`),
          fetch("/api/shopify/inventory?store=ALL"),
        ]);

        const ordersJson = await ordersRes.json();
        if (!ordersRes.ok) throw new Error(ordersJson.error);
        setOrders(ordersJson.orders || []);
        if (ordersJson.stores) setStores(ordersJson.stores);

        // Build stock map: "STORE::sku_lower" → quantity
        if (inventoryRes.ok) {
          const invJson = await inventoryRes.json();
          const rows: InventoryRow[] = invJson.rows || [];
          const map = new Map<string, number>();
          for (const row of rows) {
            if (!row.sku) continue;
            const key = `${row.store_name}::${row.sku}`.toLowerCase();
            map.set(key, (map.get(key) || 0) + row.stock);
            const skuKey = row.sku.toLowerCase();
            map.set(skuKey, (map.get(skuKey) || 0) + row.stock);
          }
          setStockMap(map);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load orders");
      } finally {
        setLoading(false);
      }
    },
    [storeFilter]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (storeFilter === "ALL") return orders;
    return orders.filter((o) => o.store_name === storeFilter);
  }, [orders, storeFilter]);

  function handleGeneratePickList(orderIds: number[]) {
    router.push(
      `/fulfillment/pick-pack/pick-list?orders=${orderIds.join(",")}&store=${storeFilter}`
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Pick &amp; Pack</h1>
          <p className="text-gray-400 mt-1">Orders with waybills — ready to pack</p>
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

      {/* Store filter */}
      <div className="flex items-center gap-2 mb-4">
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Orders Queue */}
      {!loading && (
        <OrdersQueue
          orders={filtered}
          stockMap={stockMap}
          onGeneratePickList={handleGeneratePickList}
          loading={loading}
        />
      )}
    </div>
  );
}
