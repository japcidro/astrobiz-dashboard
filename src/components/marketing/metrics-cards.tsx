import {
  DollarSign,
  Target,
  TrendingUp,
  ShoppingCart,
  Eye,
  Users,
} from "lucide-react";
import type { FBInsights } from "@/lib/facebook/types";

interface MetricsCardsProps {
  insights: FBInsights | null;
  loading?: boolean;
}

export function MetricsCards({ insights, loading }: MetricsCardsProps) {
  const formatCurrency = (val: number) =>
    `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatNumber = (val: number) =>
    val.toLocaleString("en-PH");

  const metrics = [
    {
      label: "Total Spend",
      value: insights ? formatCurrency(insights.spend) : "—",
      icon: <DollarSign size={20} className="text-red-400" />,
      bg: "bg-red-600/20",
    },
    {
      label: "Results",
      value: insights ? formatNumber(insights.results) : "—",
      icon: <Target size={20} className="text-blue-400" />,
      bg: "bg-blue-600/20",
    },
    {
      label: "CPA",
      value: insights ? formatCurrency(insights.cpa) : "—",
      icon: <TrendingUp size={20} className="text-yellow-400" />,
      bg: "bg-yellow-600/20",
    },
    {
      label: "ROAS",
      value: insights ? `${insights.roas.toFixed(2)}x` : "—",
      icon: <TrendingUp size={20} className="text-green-400" />,
      bg: "bg-green-600/20",
    },
    {
      label: "Add to Cart",
      value: insights ? formatNumber(insights.add_to_cart) : "—",
      icon: <ShoppingCart size={20} className="text-purple-400" />,
      bg: "bg-purple-600/20",
    },
    {
      label: "Purchases",
      value: insights ? formatNumber(insights.purchases) : "—",
      icon: <ShoppingCart size={20} className="text-emerald-400" />,
      bg: "bg-emerald-600/20",
    },
    {
      label: "Reach",
      value: insights ? formatNumber(insights.reach) : "—",
      icon: <Users size={20} className="text-cyan-400" />,
      bg: "bg-cyan-600/20",
    },
    {
      label: "Impressions",
      value: insights ? formatNumber(insights.impressions) : "—",
      icon: <Eye size={20} className="text-orange-400" />,
      bg: "bg-orange-600/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 ${m.bg} rounded-lg`}>{m.icon}</div>
            <span className="text-xs text-gray-400">{m.label}</span>
          </div>
          {loading ? (
            <div className="h-7 bg-gray-700/50 rounded animate-pulse" />
          ) : (
            <p className="text-lg font-bold text-white">{m.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
