"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, ChevronDown, AlertTriangle, CheckCircle } from "lucide-react";
import { AngleScriptGenerator } from "@/components/ai/angle-script-generator";
import { FormatExpansion } from "@/components/ai/format-expansion";
import type { AiStoreDoc } from "@/lib/ai/types";
import { DOC_TYPES } from "@/lib/ai/types";

type Tab = "angle-script" | "format-expansion";

interface StoreOption {
  name: string;
}

export default function AiGeneratorPage() {
  const [storeName, setStoreName] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [docs, setDocs] = useState<AiStoreDoc[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("angle-script");
  const [loading, setLoading] = useState(true);

  // Fetch stores on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/shopify/stores");
        const data = await res.json();
        const storeList: StoreOption[] = (data.stores || data || []).map(
          (s: { name: string }) => ({ name: s.name })
        );
        setStores(storeList);
        if (storeList.length > 0) {
          setStoreName(storeList[0].name);
        }
      } catch {
        // handled by empty stores
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch docs when store changes
  const fetchDocs = useCallback(async (store: string) => {
    if (!store) return;
    try {
      const res = await fetch(
        `/api/ai/docs?store=${encodeURIComponent(store)}`
      );
      const data = await res.json();
      setDocs(data.docs || data || []);
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    if (storeName) {
      fetchDocs(storeName);
    }
  }, [storeName, fetchDocs]);

  const docsReady = DOC_TYPES.filter((dt) =>
    docs.some((d) => d.doc_type === dt.key)
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <Sparkles size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Generator</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Generate angles, scripts, and format expansions
            </p>
          </div>
        </div>

        {/* Store Selector */}
        <div className="relative">
          <select
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            className="appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer min-w-[180px]"
          >
            {stores.length === 0 && (
              <option value="">No stores available</option>
            )}
            {stores.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>
      </div>

      {/* Readiness Banner */}
      {storeName && (
        <div
          className={`mb-6 p-3 rounded-lg flex items-center gap-2 text-sm ${
            docsReady === 8
              ? "bg-green-900/30 border border-green-700/50 text-green-300"
              : "bg-yellow-900/30 border border-yellow-700/50 text-yellow-300"
          }`}
        >
          {docsReady === 8 ? (
            <>
              <CheckCircle size={16} />
              8/8 docs ready — All knowledge documents are set
            </>
          ) : (
            <>
              <AlertTriangle size={16} />
              {docsReady}/8 docs ready —{" "}
              <a
                href="/marketing/ai-settings"
                className="underline hover:text-yellow-200"
              >
                Go to AI Knowledge
              </a>{" "}
              to fill in the remaining documents
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("angle-script")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === "angle-script"
              ? "bg-emerald-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700/50"
          }`}
        >
          Angle &rarr; Script
        </button>
        <button
          onClick={() => setActiveTab("format-expansion")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === "format-expansion"
              ? "bg-emerald-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700/50"
          }`}
        >
          Format Expansion
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "angle-script" && (
        <AngleScriptGenerator storeName={storeName} docsReady={docsReady} />
      )}
      {activeTab === "format-expansion" && (
        <FormatExpansion storeName={storeName} docsReady={docsReady} />
      )}
    </div>
  );
}
