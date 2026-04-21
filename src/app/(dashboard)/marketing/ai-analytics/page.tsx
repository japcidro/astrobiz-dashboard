"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  RefreshCw,
  Sparkles,
  Video,
  AlertCircle,
} from "lucide-react";
import type { DatePreset } from "@/lib/facebook/types";
import { ChatPanel, type ChatAd, type ChatTotals } from "@/components/marketing/chat-panel";
import { DeconstructionPanel } from "@/components/marketing/deconstruction-panel";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7d" },
  { label: "Last 14 Days", value: "last_14d" },
  { label: "Last 30 Days", value: "last_30d" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
];

interface AdRow extends ChatAd {
  thumbnail_url?: string | null;
  preview_url?: string | null;
}

interface AccountInfo {
  id: string;
  name: string;
}

type Tab = "chat" | "deconstruct";

export default function AiAnalyticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deconstructAdParam = searchParams.get("deconstruct_ad");

  const [tab, setTab] = useState<Tab>(deconstructAdParam ? "deconstruct" : "chat");

  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [totals, setTotals] = useState<ChatTotals>({
    spend: 0,
    purchases: 0,
    link_clicks: 0,
    impressions: 0,
  });
  const [loadingAds, setLoadingAds] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadAds = useCallback(
    async (forceRefresh: boolean) => {
      let cancelled = false;
      setLoadingAds(true);
      setLoadError(null);
      try {
        const refreshParam = forceRefresh ? "&refresh=1" : "";
        const res = await fetch(
          `/api/facebook/all-ads?date_preset=${datePreset}&account=${accountFilter}${refreshParam}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load ads");
        if (cancelled) return;
        const initialAds = (json.data as AdRow[]) ?? [];
        setAds(initialAds);
        setAccounts((json.accounts as AccountInfo[]) ?? []);
        if (json.totals) setTotals(json.totals as ChatTotals);

        const targetIds = [...initialAds]
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 60)
          .map((a) => a.ad_id)
          .filter(Boolean);
        if (targetIds.length > 0) {
          try {
            const crRes = await fetch(
              `/api/facebook/ad-creatives?ids=${targetIds.join(",")}`
            );
            if (crRes.ok) {
              const crJson = (await crRes.json()) as {
                creatives: Record<
                  string,
                  { preview_url: string | null; thumbnail_url: string | null }
                >;
              };
              if (cancelled) return;
              const creatives = crJson.creatives ?? {};
              setAds((prev) =>
                prev.map((row) => {
                  const c = creatives[row.ad_id];
                  if (!c) return row;
                  return {
                    ...row,
                    preview_url: c.preview_url,
                    thumbnail_url: c.thumbnail_url,
                  };
                })
              );
            }
          } catch {
            // non-critical
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load ads");
        }
      } finally {
        if (!cancelled) setLoadingAds(false);
      }
      return () => {
        cancelled = true;
      };
    },
    [datePreset, accountFilter]
  );

  useEffect(() => {
    loadAds(refreshNonce > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset, accountFilter, refreshNonce]);

  const deconstructAds = useMemo(
    () =>
      ads
        .map((a) => ({
          ad_id: a.ad_id,
          ad: a.ad,
          account: a.account,
          account_id: a.account_id,
          campaign: a.campaign,
          adset: a.adset,
          spend: a.spend,
          purchases: a.purchases,
          cpa: a.cpa,
          roas: a.roas,
          thumbnail_url: a.thumbnail_url ?? null,
          preview_url: a.preview_url ?? null,
        }))
        .sort((a, b) => b.spend - a.spend),
    [ads]
  );

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <BarChart3 size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Analytics</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Chat with your ads data. Deconstruct winning creatives.
            </p>
          </div>
        </div>
        <button
          onClick={() => setRefreshNonce((n) => n + 1)}
          disabled={loadingAds}
          title="Force-refresh ads data + thumbnails (skips cache)"
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loadingAds ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Date preset chips */}
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

      {/* Secondary filters */}
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
        {loadingAds ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <RefreshCw size={12} className="animate-spin" />
            Loading ads…
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            {ads.length} ads · ₱{totals.spend.toFixed(0)} spend ·{" "}
            {totals.purchases} purchases
          </div>
        )}
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {loadError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("chat")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "chat"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          <Sparkles size={14} /> Chat Insights
        </button>
        <button
          onClick={() => setTab("deconstruct")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "deconstruct"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          <Video size={14} /> Creative Deconstruction
        </button>
      </div>

      {tab === "chat" && (
        <ChatPanel
          ads={ads}
          totals={totals}
          datePreset={datePreset}
          accountFilter={accountFilter}
          accountCount={accounts.length}
          loadingAds={loadingAds}
        />
      )}

      {tab === "deconstruct" && (
        <DeconstructionPanel
          ads={deconstructAds}
          datePreset={datePreset}
          initialAdId={deconstructAdParam}
          onAutoAnalyzeHandled={() => {
            router.replace("/marketing/ai-analytics");
          }}
        />
      )}
    </div>
  );
}
