"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { UnfulfilledOrder } from "@/lib/fulfillment/types";
import { OrdersQueue } from "@/components/fulfillment/orders-queue";

export default function PickPackPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<UnfulfilledOrder[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("ALL");

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store: storeFilter });
        if (forceRefresh) params.set("refresh", "1");

        const res = await fetch(`/api/shopify/fulfillment?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        setOrders(json.orders || []);
        if (json.stores) setStores(json.stores);
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
    return orders.filter((o) => o.store_id === storeFilter);
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
          <p className="text-gray-400 mt-1">Unfulfilled orders queue</p>
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
            <option key={s.id} value={s.id}>
              {s.name}
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
          onGeneratePickList={handleGeneratePickList}
          loading={loading}
        />
      )}
    </div>
  );
}
