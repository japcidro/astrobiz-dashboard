"use client";

import { useState, useEffect } from "react";
import { Trophy, RefreshCw } from "lucide-react";
import { ApprovedLibrary } from "@/components/marketing/approved-library";

// Module-level cache so the brand selection survives in-app navigation.
let cachedStoreName = "";

export default function ApprovedLibraryPage() {
  const [stores, setStores] = useState<{ name: string }[]>([]);
  const [storeName, setStoreName] = useState(cachedStoreName);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cachedStoreName = storeName;
  }, [storeName]);

  useEffect(() => {
    fetch("/api/shopify/stores")
      .then((r) => r.json())
      .then((json) => {
        const storeList = (json.stores || json || []).map(
          (s: { name: string }) => ({ name: s.name })
        );
        setStores(storeList);
        if (storeList.length > 0 && !storeName) {
          setStoreName(storeList[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Trophy size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Approved Library</h1>
            <p className="text-gray-400 text-sm">
              Approved ad scripts, linked creatives, and per-script performance.
            </p>
          </div>
        </div>
        <select
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {stores.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-hidden">
        <ApprovedLibrary storeName={storeName} />
      </div>
    </div>
  );
}
