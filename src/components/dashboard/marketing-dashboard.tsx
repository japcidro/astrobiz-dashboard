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

function formatCurrency(num: number): string {
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MarketingDashboard({
  employeeName,
  hoursToday,
  hasActiveSession,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<AdsTotals | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/facebook/all-ads?date_preset=today")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((data) => setTotals(data?.totals ?? null))
      .catch(() => {
        setTotals(null);
        setError(true);
      })
      .finally(() => setLoading(false));
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

      {/* Today's Ad Performance */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Today&apos;s Ad Performance
        </h2>
        {error && !loading ? (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 text-center">
            <p className="text-gray-400 text-sm">
              Ad data unavailable. Please check your Facebook token
              configuration.
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
                (totals?.roas ?? 0) > 1
                  ? "border-green-500/30"
                  : "border-red-500/30"
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
