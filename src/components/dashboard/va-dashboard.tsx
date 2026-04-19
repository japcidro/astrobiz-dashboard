"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  Clock,
  CheckCircle,
  Timer,
  ClipboardList,
  Store,
} from "lucide-react";
import { StatCard } from "./stat-card";
import { ActionItem } from "./action-item";

interface Props {
  employeeName: string;
  hoursToday: string;
  hasActiveSession: boolean;
}

interface OrdersSummary {
  total_orders: number;
  unfulfilled_count: number;
  fulfilled_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}

interface StoreBreakdown {
  store_name: string;
  total: number;
  unfulfilled: number;
  aging: number;
  fulfilled: number;
}

export function VADashboard({
  employeeName: _employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [stores, setStores] = useState<StoreBreakdown[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  useEffect(() => {
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch("/api/shopify/orders?date_filter=today&store=ALL")
        .then(({ data }) =>
          setSummary((data as Record<string, unknown>)?.summary as typeof summary ?? null)
        )
        .catch(() => setSummary(null))
        .finally(() => setLoading(false))
    );

    fetch("/api/va/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStores(d.stores ?? []);
      })
      .catch(() => {})
      .finally(() => setStoresLoading(false));
  }, []);

  const agingTotal =
    (summary?.aging_warning_count ?? 0) + (summary?.aging_danger_count ?? 0);

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

      {/* Today's Orders */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Today&apos;s Orders
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Orders"
            value={String(summary?.total_orders ?? 0)}
            icon={<Package size={16} />}
            iconBg="bg-blue-500/20 text-blue-400"
            accentBorder="border-blue-500/30"
            loading={loading}
          />
          <StatCard
            label="Unfulfilled"
            value={String(summary?.unfulfilled_count ?? 0)}
            icon={<AlertTriangle size={16} />}
            iconBg="bg-yellow-500/20 text-yellow-400"
            accentBorder="border-yellow-500/30"
            loading={loading}
          />
          <StatCard
            label="Aging (3+ days)"
            value={String(agingTotal)}
            icon={<Clock size={16} />}
            iconBg={
              agingTotal > 0
                ? "bg-red-500/20 text-red-400"
                : "bg-gray-500/20 text-gray-400"
            }
            accentBorder={
              agingTotal > 0
                ? "border-red-500/30"
                : "border-gray-700/50"
            }
            loading={loading}
          />
          <StatCard
            label="Fulfilled"
            value={String(summary?.fulfilled_count ?? 0)}
            icon={<CheckCircle size={16} />}
            iconBg="bg-green-500/20 text-green-400"
            accentBorder="border-green-500/30"
            loading={loading}
          />
        </div>
      </div>

      {/* Store Breakdown */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">By Store</h2>
        {storesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-20 bg-gray-800/30 rounded-lg animate-pulse" />
            <div className="h-20 bg-gray-800/30 rounded-lg animate-pulse" />
          </div>
        ) : stores.length === 0 ? (
          <p className="text-sm text-gray-500">No orders today.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stores.map((store) => (
              <Link
                key={store.store_name}
                href={`/va/orders?store=${encodeURIComponent(store.store_name)}`}
                className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 rounded-lg p-4 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Store size={14} className="text-gray-400" />
                  <span className="text-sm font-medium text-white truncate">
                    {store.store_name}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="text-lg font-semibold text-white">{store.total}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Unfulfilled</p>
                    <p
                      className={`text-lg font-semibold ${
                        store.unfulfilled > 0 ? "text-yellow-400" : "text-gray-600"
                      }`}
                    >
                      {store.unfulfilled}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Aging</p>
                    <p
                      className={`text-lg font-semibold ${
                        store.aging > 0 ? "text-red-400" : "text-gray-600"
                      }`}
                    >
                      {store.aging}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Needs Attention */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Needs Attention
        </h2>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-2">
          <ActionItem
            label="Unfulfilled orders"
            count={summary?.unfulfilled_count ?? 0}
            href="/va/orders"
            severity="warning"
            icon={<AlertTriangle size={16} />}
          />
          <ActionItem
            label="Orders aging 3+ days"
            count={agingTotal}
            href="/va/orders"
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
            href="/va/orders"
            className="flex items-center gap-3 p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <ClipboardList size={20} className="text-yellow-400" />
            <span className="text-sm text-gray-300">Orders &amp; Parcels</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
