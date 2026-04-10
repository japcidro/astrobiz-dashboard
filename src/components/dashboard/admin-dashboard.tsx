"use client";

import { useEffect, useState } from "react";
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

// Module-level cache — survives navigation, cleared on full page reload
let dashboardCache: {
  todayOrders: OrdersSummary | null;
  monthOrders: OrdersSummary | null;
  todayAds: AdsTotals | null;
  monthAds: AdsTotals | null;
  inventory: InventorySummary | null;
} = { todayOrders: null, monthOrders: null, todayAds: null, monthAds: null, inventory: null };

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
  const [loading, setLoading] = useState(!dashboardCache.todayOrders);
  const [todayOrders, setTodayOrders] = useState<OrdersSummary | null>(dashboardCache.todayOrders);
  const [monthOrders, setMonthOrders] = useState<OrdersSummary | null>(dashboardCache.monthOrders);
  const [todayAds, setTodayAds] = useState<AdsTotals | null>(dashboardCache.todayAds);
  const [monthAds, setMonthAds] = useState<AdsTotals | null>(dashboardCache.monthAds);
  const [inventory, setInventory] = useState<InventorySummary | null>(dashboardCache.inventory);

  useEffect(() => {
    Promise.allSettled([
      fetch("/api/shopify/orders?date_filter=today&store=ALL").then((r) => r.json()),
      fetch("/api/shopify/orders?date_filter=this_month&store=ALL").then((r) => r.json()),
      fetch("/api/facebook/all-ads?date_preset=today").then((r) => r.json()),
      fetch("/api/facebook/all-ads?date_preset=this_month").then((r) => r.json()),
      fetch("/api/shopify/inventory?store=ALL").then((r) => r.json()),
    ]).then(([todayOrd, monthOrd, todayAd, monthAd, inv]) => {
      const to = todayOrd.status === "fulfilled" ? todayOrd.value?.summary ?? null : null;
      const mo = monthOrd.status === "fulfilled" ? monthOrd.value?.summary ?? null : null;
      const ta = todayAd.status === "fulfilled" ? todayAd.value?.totals ?? null : null;
      const ma = monthAd.status === "fulfilled" ? monthAd.value?.totals ?? null : null;
      const iv = inv.status === "fulfilled" ? inv.value?.summary ?? null : null;

      setTodayOrders(to);
      setMonthOrders(mo);
      setTodayAds(ta);
      setMonthAds(ma);
      setInventory(iv);

      // Cache in module scope so navigating back shows data instantly
      dashboardCache = { todayOrders: to, monthOrders: mo, todayAds: ta, monthAds: ma, inventory: iv };
      setLoading(false);
    });
  }, []);

  const agingTotal =
    (todayOrders?.aging_warning_count ?? 0) +
    (todayOrders?.aging_danger_count ?? 0);

  const unfulfilledSubtitle =
    agingTotal > 0 ? `(${agingTotal} aging)` : undefined;

  const outOfStock = inventory?.out_of_stock_count ?? 0;

  return (
    <div>
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
