"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, CheckCircle } from "lucide-react";
import type { CogsItem } from "@/lib/profit/types";
import { CogsManager } from "@/components/profit/cogs-manager";

export default function CogsPage() {
  const searchParams = useSearchParams();
  const addSkusParam = searchParams.get("add_skus");

  const [items, setItems] = useState<CogsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAdded, setAutoAdded] = useState<string[]>([]);

  useEffect(() => {
    async function fetchAndAutoAdd() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/profit/cogs");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load COGS");
        let currentItems: CogsItem[] = json.items || [];

        // Auto-add missing SKUs from URL param
        if (addSkusParam) {
          const skusToAdd = addSkusParam.split(",").filter(Boolean);
          const existingSkus = new Set(currentItems.map((i) => `${i.store_name}::${i.sku}`.toLowerCase()));
          const newItems: Array<{ store_name: string; sku: string; product_name: string; cogs_per_unit: number }> = [];

          for (const skuKey of skusToAdd) {
            if (existingSkus.has(skuKey.toLowerCase())) continue;
            // skuKey format is "STORE::sku"
            const parts = skuKey.split("::");
            const storeName = parts[0] || "";
            const sku = parts[1] || skuKey;
            newItems.push({
              store_name: storeName,
              sku,
              product_name: "",
              cogs_per_unit: 0,
            });
          }

          if (newItems.length > 0) {
            const addRes = await fetch("/api/profit/cogs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: newItems }),
            });
            if (addRes.ok) {
              setAutoAdded(newItems.map((i) => i.sku));
              // Re-fetch to get updated list
              const refreshRes = await fetch("/api/profit/cogs");
              const refreshJson = await refreshRes.json();
              if (refreshRes.ok) currentItems = refreshJson.items || [];
            }
          }
        }

        setItems(currentItems);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load COGS");
      } finally {
        setLoading(false);
      }
    }
    fetchAndAutoAdd();
  }, [addSkusParam]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">COGS Management</h1>
        <p className="text-gray-400 mt-1">Cost of goods sold per SKU</p>
      </div>

      {/* Auto-added banner */}
      {autoAdded.length > 0 && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-xl text-green-300 text-sm flex items-center gap-2">
          <CheckCircle size={16} />
          Auto-added {autoAdded.length} missing SKU{autoAdded.length !== 1 ? "s" : ""}: {autoAdded.join(", ")} — fill in the COGS values below
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* COGS Manager */}
      {!loading && !error && <CogsManager initialItems={items} />}
    </div>
  );
}
