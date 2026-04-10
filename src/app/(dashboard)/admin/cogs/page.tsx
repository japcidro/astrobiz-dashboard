"use client";

import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type { CogsItem } from "@/lib/profit/types";
import { CogsManager } from "@/components/profit/cogs-manager";

export default function CogsPage() {
  const [items, setItems] = useState<CogsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCogs() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/profit/cogs");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load COGS");
        setItems(json.items || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load COGS");
      } finally {
        setLoading(false);
      }
    }
    fetchCogs();
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">COGS Management</h1>
        <p className="text-gray-400 mt-1">Cost of goods sold per SKU</p>
      </div>

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
