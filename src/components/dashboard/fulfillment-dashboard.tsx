"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  XCircle,
  Archive,
  Clock,
  CheckCircle,
  Timer,
  Boxes,
  ClipboardList,
  TrendingDown,
  ScanLine,
  ArrowRight,
} from "lucide-react";
import { StatCard } from "./stat-card";
import { ActionItem } from "./action-item";

interface Props {
  employeeName: string;
  hoursToday: string;
  hasActiveSession: boolean;
}

interface InventorySummary {
  out_of_stock_count: number;
  low_stock_count: number;
  total_units: number;
  total_products: number;
}

interface UnfulfilledOrder {
  order_number: string;
  age_days: number;
}

interface TodayData {
  pack_queue: number;
  my_verified_today: number;
  team_verified_today: number;
  low_runway_skus: Array<{
    product_title: string;
    sku: string | null;
    stock: number;
    runway_days: number;
    velocity_per_day: number;
    store_name: string;
  }>;
}

export function FulfillmentDashboard({
  employeeName: _employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(true);
  const [unfulfilledOrders, setUnfulfilledOrders] = useState<UnfulfilledOrder[]>([]);
  const [today, setToday] = useState<TodayData | null>(null);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) => {
      cachedFetch("/api/shopify/inventory?store=ALL")
        .then(({ data }) =>
          setSummary((data as Record<string, unknown>)?.summary as typeof summary ?? null)
        )
        .catch(() => setSummary(null))
        .finally(() => setLoading(false));

      cachedFetch("/api/shopify/fulfillment")
        .then(({ data }) => {
          const orders = (data as Record<string, unknown>)?.orders as UnfulfilledOrder[] ?? [];
          setUnfulfilledOrders(orders);
        })
        .catch(() => setUnfulfilledOrders([]))
        .finally(() => setFulfillmentLoading(false));
    });

    fetch("/api/fulfillment/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setToday(d);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      {/* Personal */}
      <div className="mb-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl">
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
          <StatCard
            label="My Verified Today"
            value={String(today?.my_verified_today ?? 0)}
            subtitle={
              today?.team_verified_today
                ? `Team: ${today.team_verified_today}`
                : undefined
            }
            icon={<ScanLine size={16} />}
            iconBg="bg-purple-500/20 text-purple-400"
            accentBorder="border-purple-500/30"
            loading={!today}
          />
        </div>
      </div>

      {/* Pack Queue CTA */}
      <div className="mb-8">
        <Link
          href="/fulfillment/pick-pack/verify"
          className="block bg-gradient-to-r from-orange-500/20 to-orange-600/10 border border-orange-500/30 rounded-xl p-5 hover:from-orange-500/30 hover:to-orange-600/20 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-orange-500/20 text-orange-400 flex items-center justify-center flex-shrink-0">
              <Package size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-orange-300 uppercase tracking-wider mb-1">
                Pack Queue
              </p>
              <p className="text-2xl font-bold text-white">
                {today?.pack_queue ?? 0}{" "}
                <span className="text-sm font-normal text-gray-400">
                  orders ready to verify
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 text-orange-300 font-medium text-sm">
              Start verifying
              <ArrowRight size={16} />
            </div>
          </div>
        </Link>
      </div>

      {/* Low Runway SKUs */}
      {today?.low_runway_skus && today.low_runway_skus.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingDown size={18} className="text-red-400" />
            SKUs Running Out Soon
          </h2>
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">
            {today.low_runway_skus.map((sku) => (
              <div
                key={`${sku.store_name}-${sku.sku}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {sku.product_title}
                  </p>
                  <p className="text-xs text-gray-500">
                    {sku.store_name} • {sku.velocity_per_day.toFixed(1)}/day velocity
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-semibold ${
                      sku.runway_days < 3 ? "text-red-400" : "text-yellow-400"
                    }`}
                  >
                    {sku.runway_days}d left
                  </p>
                  <p className="text-xs text-gray-600">{sku.stock} in stock</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inventory Health */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Inventory Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Out of Stock"
            value={String(summary?.out_of_stock_count ?? 0)}
            icon={<XCircle size={16} />}
            iconBg="bg-red-500/20 text-red-400"
            accentBorder="border-red-500/30"
            loading={loading}
          />
          <StatCard
            label="Low Stock"
            value={String(summary?.low_stock_count ?? 0)}
            icon={<AlertTriangle size={16} />}
            iconBg="bg-yellow-500/20 text-yellow-400"
            accentBorder="border-yellow-500/30"
            loading={loading}
          />
          <StatCard
            label="Total Units"
            value={String(summary?.total_units ?? 0)}
            icon={<Archive size={16} />}
            iconBg="bg-green-500/20 text-green-400"
            accentBorder="border-green-500/30"
            loading={loading}
          />
          <StatCard
            label="Total Products"
            value={String(summary?.total_products ?? 0)}
            icon={<Package size={16} />}
            iconBg="bg-blue-500/20 text-blue-400"
            accentBorder="border-blue-500/30"
            loading={loading}
          />
        </div>
      </div>

      {/* Fulfillment Queue */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Fulfillment Queue</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Unfulfilled Orders"
            value={String(unfulfilledOrders.length)}
            icon={<Package size={16} />}
            iconBg="bg-orange-500/20 text-orange-400"
            accentBorder="border-orange-500/30"
            loading={fulfillmentLoading}
          />
          <StatCard
            label="Aging (3+ days)"
            value={String(unfulfilledOrders.filter((o) => o.age_days >= 3).length)}
            icon={<AlertTriangle size={16} />}
            iconBg={
              unfulfilledOrders.filter((o) => o.age_days >= 3).length > 0
                ? "bg-red-500/20 text-red-400"
                : "bg-gray-500/20 text-gray-400"
            }
            accentBorder={
              unfulfilledOrders.filter((o) => o.age_days >= 3).length > 0
                ? "border-red-500/30"
                : "border-gray-700/50"
            }
            loading={fulfillmentLoading}
          />
        </div>
      </div>

      {/* Needs Attention */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Needs Attention</h2>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-2">
          <ActionItem
            label="Out of stock products"
            count={summary?.out_of_stock_count ?? 0}
            href="/fulfillment/inventory"
            severity="danger"
            icon={<XCircle size={16} />}
          />
          <ActionItem
            label="Low stock products (<10)"
            count={summary?.low_stock_count ?? 0}
            href="/fulfillment/inventory"
            severity="warning"
            icon={<AlertTriangle size={16} />}
          />
          <ActionItem
            label="Unfulfilled orders waiting"
            count={unfulfilledOrders.length}
            href="/fulfillment/pick-pack"
            severity="warning"
            icon={<Package size={16} />}
          />
          <ActionItem
            label="Orders aging 3+ days"
            count={unfulfilledOrders.filter((o) => o.age_days >= 3).length}
            href="/fulfillment/pick-pack"
            severity="danger"
            icon={<Clock size={16} />}
          />
        </div>
      </div>

      {/* Quick Links */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Links</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/time-tracker"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Timer size={20} className="text-blue-400" />
            <span className="text-sm text-gray-300">Time Tracker</span>
          </Link>
          <Link
            href="/fulfillment/inventory"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Boxes size={20} className="text-green-400" />
            <span className="text-sm text-gray-300">Inventory</span>
          </Link>
          <Link
            href="/fulfillment/pick-pack"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <ClipboardList size={20} className="text-orange-400" />
            <span className="text-sm text-gray-300">Pick &amp; Pack</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
