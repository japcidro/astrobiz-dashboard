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

export function FulfillmentDashboard({
  employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(true);
  const [unfulfilledOrders, setUnfulfilledOrders] = useState<UnfulfilledOrder[]>([]);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) => {
      cachedFetch("/api/shopify/inventory?store=ALL")
        .then(({ data }) => setSummary((data as Record<string, unknown>)?.summary as typeof summary ?? null))
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

      {/* Inventory Health */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Inventory Health
        </h2>
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
        <h2 className="text-lg font-semibold text-white mb-4">
          Fulfillment Queue
        </h2>
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
        <h2 className="text-lg font-semibold text-white mb-4">
          Needs Attention
        </h2>
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
