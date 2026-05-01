"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import type { DatePreset } from "@/lib/facebook/types";
import { ChatPanel } from "@/components/marketing/chat-panel";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 14 Days", value: "last_14d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
];

interface AccountInfo {
  id: string;
  name: string;
}

// Slimmed-down AI Analytics surface — chat agent only.
//
// Creative deconstruction + winners curation moved to /marketing/creatives.
// Old deep links of the form ?deconstruct_ad=X are redirected to the new
// page so cron alert action_urls and bookmarks keep working.
export default function AiAnalyticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deconstructAdParam = searchParams.get("deconstruct_ad");

  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loadingAds, setLoadingAds] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Honor old deep-links from cron alerts / saved URLs by redirecting to
  // the new Creatives page, optionally pre-selecting the ad.
  useEffect(() => {
    if (deconstructAdParam) {
      router.replace(
        `/marketing/creatives?ad_id=${encodeURIComponent(deconstructAdParam)}`
      );
    }
  }, [deconstructAdParam, router]);

  const loadAds = useCallback(
    async (forceRefresh: boolean) => {
      setLoadingAds(true);
      setLoadError(null);
      try {
        const refreshParam = forceRefresh ? "&refresh=1" : "";
        const res = await fetch(
          `/api/facebook/all-ads?date_preset=${datePreset}&account=${accountFilter}${refreshParam}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load ads");
        setAccounts((json.accounts as AccountInfo[]) ?? []);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load ads");
      } finally {
        setLoadingAds(false);
      }
    },
    [datePreset, accountFilter]
  );

  useEffect(() => {
    loadAds(refreshNonce > 0);
  }, [loadAds, refreshNonce]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <BarChart3 size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Analytics</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Chat with your ads data.
            </p>
          </div>
        </div>
        <button
          onClick={() => setRefreshNonce((n) => n + 1)}
          disabled={loadingAds}
          title="Force-refresh ads data (skips cache)"
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loadingAds ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <Link
        href="/marketing/creatives"
        className="mb-4 flex items-center justify-between gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/15 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Sparkles size={18} className="text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-white">
              Creative Deconstruction moved to Creatives
            </p>
            <p className="text-[11px] text-amber-200/80">
              Browse, analyze, and curate winners para auto-feed sa angle
              generator + format expansion.
            </p>
          </div>
        </div>
        <ArrowRight size={16} className="text-amber-300" />
      </Link>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {DATE_PRESETS.map((p) => {
          const active = datePreset === p.value;
          return (
            <button
              key={p.value}
              onClick={() => setDatePreset(p.value)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                active
                  ? "bg-emerald-600 border-emerald-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">Account:</label>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-emerald-500 focus:border-emerald-500 max-w-[240px]"
          >
            <option value="ALL">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {loadingAds && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <RefreshCw size={12} className="animate-spin" />
            Loading…
          </div>
        )}
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {loadError}
        </div>
      )}

      <ChatPanel datePreset={datePreset} />
    </div>
  );
}
