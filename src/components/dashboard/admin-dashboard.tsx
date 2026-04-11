"use client";

import { useEffect, useState } from "react";
import { cachedFetch, formatLastRefreshed } from "@/lib/client-cache";
import {
  Package,
  TrendingUp,
  AlertTriangle,
  Users,
  Clock,
  XCircle,
  Target,
} from "lucide-react";
import { StatCard } from "./stat-card";
import { ActionItem } from "./action-item";

interface Props {
  employeeName: string;
  teamTotalHours: number;
  teamNotClockedIn: number;
}

interface OrdersSummary {
  total_revenue: number;
  total_orders: number;
  unfulfilled_count: number;
  fulfilled_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}

interface AdsTotals {
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
}

interface InventorySummary {
  total_units: number;
  total_products: number;
  out_of_stock_count: number;
  low_stock_count: number;
}

function formatCurrency(num: number): string {
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatHours(seconds: number): string {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function AdminDashboard({
  employeeName,
  teamTotalHours,
  teamNotClockedIn,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [todayOrders, setTodayOrders] = useState<OrdersSummary | null>(null);
  const [monthOrders, setMonthOrders] = useState<OrdersSummary | null>(null);
  const [todayAds, setTodayAds] = useState<AdsTotals | null>(null);
  const [monthAds, setMonthAds] = useState<AdsTotals | null>(null);
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  useEffect(() => {
    Promise.allSettled([
      cachedFetch("/api/shopify/orders?date_filter=today&store=ALL"),
      cachedFetch("/api/shopify/orders?date_filter=this_month&store=ALL"),
      cachedFetch("/api/facebook/all-ads?date_preset=today"),
      cachedFetch("/api/facebook/all-ads?date_preset=this_month"),
      cachedFetch("/api/shopify/inventory?store=ALL"),
    ]).then(([todayOrd, monthOrd, todayAd, monthAd, inv]) => {
      const toData = todayOrd.status === "fulfilled" ? todayOrd.value : null;
      const moData = monthOrd.status === "fulfilled" ? monthOrd.value : null;
      const taData = todayAd.status === "fulfilled" ? todayAd.value : null;
      const maData = monthAd.status === "fulfilled" ? monthAd.value : null;
      const ivData = inv.status === "fulfilled" ? inv.value : null;

      setTodayOrders((toData?.data as Record<string, unknown>)?.summary as OrdersSummary ?? null);
      setMonthOrders((moData?.data as Record<string, unknown>)?.summary as OrdersSummary ?? null);
      setTodayAds((taData?.data as Record<string, unknown>)?.totals as AdsTotals ?? null);
      setMonthAds((maData?.data as Record<string, unknown>)?.totals as AdsTotals ?? null);
      setInventory((ivData?.data as Record<string, unknown>)?.summary as InventorySummary ?? null);

      // Find the oldest timestamp for "last refreshed"
      const timestamps = [todayOrd, monthOrd, todayAd, monthAd, inv]
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<{ timestamp: number }>).value.timestamp);
      if (timestamps.length > 0) {
        setLastRefreshed(formatLastRefreshed(Math.min(...timestamps)));
      }

      setLoading(false);
    });

    // Update "last refreshed" text every 30s
    const interval = setInterval(() => {
      // Re-read from cache timestamps
      setLastRefreshed((prev) => prev); // trigger re-render handled by interval
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const agingTotal =
    (todayOrders?.aging_warning_count ?? 0) +
    (todayOrders?.aging_danger_count ?? 0);

  const unfulfilledSubtitle =
    agingTotal > 0 ? `(${agingTotal} aging)` : undefined;

  const outOfStock = inventory?.out_of_stock_count ?? 0;

  return (
    <div>
      {/* Last refreshed indicator */}
      {lastRefreshed && (
        <p className="text-xs text-gray-600 mb-4">
          Last refreshed: {lastRefreshed}
        </p>
      )}

      {/* Today's Highlights */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Today&apos;s Highlights
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(todayOrders?.total_revenue ?? 0)}
            icon={<span className="text-sm font-bold">₱</span>}
            iconBg="bg-green-500/20 text-green-400"
            accentBorder="border-green-500/30"
            loading={loading}
          />
          <StatCard
            label="Today's Orders"
            value={String(todayOrders?.total_orders ?? 0)}
            icon={<Package size={16} />}
            iconBg="bg-blue-500/20 text-blue-400"
            accentBorder="border-blue-500/30"
            loading={loading}
          />
          <StatCard
            label="Today's Ad Spend"
            value={formatCurrency(todayAds?.spend ?? 0)}
            icon={<TrendingUp size={16} />}
            iconBg="bg-orange-500/20 text-orange-400"
            accentBorder="border-orange-500/30"
            loading={loading}
          />
          <StatCard
            label="Unfulfilled"
            value={String(todayOrders?.unfulfilled_count ?? 0)}
            subtitle={unfulfilledSubtitle}
            subtitleColor={agingTotal > 0 ? "text-red-400" : undefined}
            icon={<AlertTriangle size={16} />}
            iconBg="bg-yellow-500/20 text-yellow-400"
            accentBorder={
              agingTotal > 0
                ? "border-red-500/30"
                : "border-yellow-500/30"
            }
            loading={loading}
          />
          <StatCard
            label="Team Hours"
            value={formatHours(teamTotalHours)}
            icon={<Users size={16} />}
            iconBg="bg-purple-500/20 text-purple-400"
            accentBorder="border-purple-500/30"
            loading={loading}
          />
        </div>
      </div>

      {/* This Month */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">This Month</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            label="Month Revenue"
            value={formatCurrency(monthOrders?.total_revenue ?? 0)}
            icon={<span className="text-sm font-bold">₱</span>}
            iconBg="bg-green-500/20 text-green-400"
            accentBorder="border-green-500/30"
            loading={loading}
          />
          <StatCard
            label="Month Orders"
            value={String(monthOrders?.total_orders ?? 0)}
            icon={<Package size={16} />}
            iconBg="bg-blue-500/20 text-blue-400"
            accentBorder="border-blue-500/30"
            loading={loading}
          />
          <StatCard
            label="Month Ad Spend"
            value={formatCurrency(monthAds?.spend ?? 0)}
            icon={<TrendingUp size={16} />}
            iconBg="bg-orange-500/20 text-orange-400"
            accentBorder="border-orange-500/30"
            loading={loading}
          />
          <StatCard
            label="ROAS"
            value={`${(monthAds?.roas ?? 0).toFixed(2)}x`}
            icon={<Target size={16} />}
            iconBg="bg-cyan-500/20 text-cyan-400"
            accentBorder="border-cyan-500/30"
            loading={loading}
          />
          <StatCard
            label="Inventory"
            value={String(inventory?.total_units ?? 0)}
            subtitle={
              outOfStock > 0 ? `${outOfStock} out of stock` : undefined
            }
            subtitleColor={outOfStock > 0 ? "text-red-400" : undefined}
            icon={<Package size={16} />}
            iconBg="bg-gray-500/20 text-gray-400"
            accentBorder={
              outOfStock > 0
                ? "border-red-500/30"
                : "border-gray-700/50"
            }
            loading={loading}
          />
        </div>
      </div>

      {/* Needs Attention */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Needs Attention
        </h2>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-2">
          <ActionItem
            label="Orders unfulfilled 3+ days"
            count={agingTotal}
            href="/va/orders"
            severity="danger"
            icon={<AlertTriangle size={16} />}
          />
          <ActionItem
            label="Out of stock products"
            count={inventory?.out_of_stock_count ?? 0}
            href="/fulfillment/inventory"
            severity="danger"
            icon={<XCircle size={16} />}
          />
          <ActionItem
            label="Low stock products"
            count={inventory?.low_stock_count ?? 0}
            href="/fulfillment/inventory"
            severity="warning"
            icon={<AlertTriangle size={16} />}
          />
          <ActionItem
            label="Team not clocked in"
            count={teamNotClockedIn}
            href="/admin/attendance"
            severity="info"
            icon={<Users size={16} />}
          />
        </div>
      </div>
    </div>
  );
}
