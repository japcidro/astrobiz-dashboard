"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Target,
  DollarSign,
  ShoppingCart,
  Clock,
  CheckCircle,
  Timer,
  BarChart3,
  PlusCircle,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Pause,
  Play,
} from "lucide-react";
import { StatCard } from "./stat-card";

interface Props {
  employeeName: string;
  hoursToday: string;
  hasActiveSession: boolean;
}

interface AdsTotals {
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
}

interface QueueItem {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  spend_7d: number;
  roas_7d: number;
  purchases_7d: number;
  reason: "scaling_winner" | "fading_winner" | "new_winner" | "dead_weight";
  reason_label: string;
}

interface AutopilotRow {
  id: string;
  action: string;
  rule_matched: string | null;
  ad_name: string | null;
  spend: number | null;
  created_at: string;
}

function formatCurrency(num: number): string {
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function queueIcon(reason: QueueItem["reason"]) {
  switch (reason) {
    case "scaling_winner":
      return <ArrowUpRight size={14} />;
    case "fading_winner":
      return <ArrowDownRight size={14} />;
    case "new_winner":
      return <Zap size={14} />;
    case "dead_weight":
      return <Pause size={14} />;
  }
}

function queueColor(reason: QueueItem["reason"]) {
  switch (reason) {
    case "scaling_winner":
      return "border-green-500/30 bg-green-500/5 text-green-400";
    case "fading_winner":
      return "border-orange-500/30 bg-orange-500/5 text-orange-400";
    case "new_winner":
      return "border-yellow-500/30 bg-yellow-500/5 text-yellow-400";
    case "dead_weight":
      return "border-red-500/30 bg-red-500/5 text-red-400";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

export function MarketingDashboard({
  employeeName: _employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<AdsTotals | null>(null);
  const [error, setError] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch("/api/facebook/all-ads?date_preset=today")
        .then(({ data }) =>
          setTotals((data as Record<string, unknown>)?.totals as typeof totals ?? null)
        )
        .catch(() => {
          setTotals(null);
          setError(true);
        })
        .finally(() => setLoading(false))
    );

    fetch("/api/marketing/action-queue", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setQueue(d.queue ?? []);
        setAutopilot(d.autopilot_last_24h ?? []);
      })
      .catch(() => {})
      .finally(() => setQueueLoading(false));
  }, []);

  return (
    <div>
      {/* Personal */}
      <div className="mb-8">
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <StatCard
            label="Hours Today"
            value={hoursToday}
            icon={<Clock size={16} />}
            iconBg="bg-blue-500/20 text-blue-400"
            accentBorder="border-blue-500/30"
            loading={false}
          />
          <StatCard
            label="Status"
            value={hasActiveSession ? "Clocked In" : "Not Clocked In"}
            icon={<CheckCircle size={16} />}
            iconBg="bg-green-500/20 text-green-400"
            accentBorder="border-green-500/30"
            loading={false}
          />
        </div>
      </div>

      {/* Action Queue */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Action Queue</h2>
        {queueLoading ? (
          <div className="space-y-2">
            <div className="h-14 bg-gray-800/30 rounded-lg animate-pulse" />
            <div className="h-14 bg-gray-800/30 rounded-lg animate-pulse" />
          </div>
        ) : queue.length === 0 ? (
          <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-400">No ads need attention right now.</p>
            <p className="text-xs text-gray-600 mt-1">
              The queue surfaces scaling winners, fading ads, and dead weight based on 7-day data.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <Link
                key={item.ad_id}
                href={`/marketing/ads?ad_id=${encodeURIComponent(item.ad_id)}`}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-white/5 ${queueColor(item.reason)}`}
              >
                <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center flex-shrink-0">
                  {queueIcon(item.reason)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {item.ad_name}
                  </p>
                  <p className="text-xs text-gray-500">{item.reason_label}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold">{item.roas_7d.toFixed(2)}x</p>
                  <p className="text-[10px] text-gray-600">
                    {item.purchases_7d} purchases
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Today's Ad Performance */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Today&apos;s Ad Performance
        </h2>
        {error && !loading ? (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 text-center">
            <p className="text-gray-400 text-sm">
              Ad data unavailable. Please check your Facebook token configuration.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Ad Spend"
              value={formatCurrency(totals?.spend ?? 0)}
              icon={<TrendingUp size={16} />}
              iconBg="bg-orange-500/20 text-orange-400"
              accentBorder="border-orange-500/30"
              loading={loading}
            />
            <StatCard
              label="ROAS"
              value={`${(totals?.roas ?? 0).toFixed(2)}x`}
              icon={<Target size={16} />}
              iconBg={
                (totals?.roas ?? 0) > 1
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }
              accentBorder={
                (totals?.roas ?? 0) > 1 ? "border-green-500/30" : "border-red-500/30"
              }
              loading={loading}
            />
            <StatCard
              label="CPA"
              value={formatCurrency(totals?.cpa ?? 0)}
              icon={<DollarSign size={16} />}
              iconBg="bg-blue-500/20 text-blue-400"
              accentBorder="border-blue-500/30"
              loading={loading}
            />
            <StatCard
              label="Purchases"
              value={String(totals?.purchases ?? 0)}
              icon={<ShoppingCart size={16} />}
              iconBg="bg-purple-500/20 text-purple-400"
              accentBorder="border-purple-500/30"
              loading={loading}
            />
          </div>
        )}
      </div>

      {/* Autopilot Activity */}
      {autopilot.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Autopilot — Last 24h
            </h2>
            <Link
              href="/marketing/ads?tab=autopilot"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              View log →
            </Link>
          </div>
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">
            {autopilot.slice(0, 5).map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <div
                  className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                    row.action === "paused"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-green-500/20 text-green-400"
                  }`}
                >
                  {row.action === "paused" ? <Pause size={12} /> : <Play size={12} />}
                </div>
                <span className="text-xs text-gray-400 capitalize flex-shrink-0 min-w-[50px]">
                  {row.action}
                </span>
                <span className="text-xs text-gray-300 truncate flex-1">
                  {row.ad_name ?? "Unknown ad"}
                </span>
                {row.rule_matched && (
                  <span className="text-[10px] text-gray-500 font-mono hidden sm:inline">
                    {row.rule_matched}
                  </span>
                )}
                <span className="text-[10px] text-gray-600 flex-shrink-0">
                  {timeAgo(row.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Link
            href="/time-tracker"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Timer size={20} className="text-blue-400" />
            <span className="text-sm text-gray-300">Time Tracker</span>
          </Link>
          <Link
            href="/marketing/ads"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <BarChart3 size={20} className="text-orange-400" />
            <span className="text-sm text-gray-300">Ad Performance</span>
          </Link>
          <Link
            href="/marketing/create"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <PlusCircle size={20} className="text-green-400" />
            <span className="text-sm text-gray-300">Create Ad</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
