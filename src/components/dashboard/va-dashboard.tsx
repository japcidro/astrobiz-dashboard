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

export function VADashboard({
  employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);

  useEffect(() => {
    const t = Date.now();
    fetch(`/api/shopify/orders?date_filter=today&store=ALL&_t=${t}`)
      .then((r) => r.json())
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
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
