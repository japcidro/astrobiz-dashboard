import { Layers, TrendingUp, Truck, RotateCcw } from "lucide-react";
import type { ProfitSummary } from "@/lib/profit/types";

interface Props {
  summary: ProfitSummary;
  loading: boolean;
  returnsProjected?: boolean;
}

export function ProfitSummaryCards({ summary, loading, returnsProjected }: Props) {
  const formatCurrency = (val: number) =>
    `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const isPositive = summary.net_profit >= 0;

  const metrics = [
    {
      label: "Revenue",
      value: formatCurrency(summary.revenue),
      icon: <span className="text-green-400 font-bold text-lg leading-none">₱</span>,
      bg: "bg-green-600/20",
      accent: "",
    },
    {
      label: "COGS",
      value: formatCurrency(summary.cogs),
      icon: <Layers size={20} className="text-orange-400" />,
      bg: "bg-orange-600/20",
      accent: "",
    },
    {
      label: "Ad Spend",
      value: formatCurrency(summary.ad_spend),
      icon: <TrendingUp size={20} className="text-blue-400" />,
      bg: "bg-blue-600/20",
      accent: "",
    },
    {
      label: "Shipping (PROJECTED)",
      value: formatCurrency(summary.shipping),
      subtitle: "12% of revenue",
      subtitleColor: "text-yellow-400",
      icon: <Truck size={20} className="text-yellow-400" />,
      bg: "bg-yellow-600/20",
      accent: "border-yellow-700/50",
    },
    {
      label: returnsProjected ? "Returns (PROJECTED)" : "Returns (ACTUAL)",
      value: formatCurrency(summary.returns_value),
      subtitle: returnsProjected ? "25% worst-case" : "From J&T data",
      subtitleColor: returnsProjected ? "text-yellow-400" : "text-green-400",
      icon: <RotateCcw size={20} className={returnsProjected ? "text-yellow-400" : "text-red-400"} />,
      bg: returnsProjected ? "bg-yellow-600/20" : "bg-red-600/20",
      accent: returnsProjected ? "border-yellow-700/50" : "",
    },
    {
      label: "Net Profit",
      value: formatCurrency(summary.net_profit),
      subtitle: `${summary.margin_pct.toFixed(1)}% margin`,
      icon: <span className={`font-bold text-lg leading-none ${isPositive ? "text-green-400" : "text-red-400"}`}>₱</span>,
      bg: isPositive ? "bg-green-600/20" : "bg-red-600/20",
      accent: isPositive ? "border-green-700/50" : "border-red-700/50",
      valueColor: isPositive ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map((m) => (
        <div
          key={m.label}
          className={`bg-gray-800/50 border rounded-xl p-4 ${
            m.accent || "border-gray-700/50"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 ${m.bg} rounded-lg`}>{m.icon}</div>
            <span className="text-xs text-gray-400">{m.label}</span>
          </div>
          {loading ? (
            <div className="h-7 bg-gray-700/50 rounded animate-pulse" />
          ) : (
            <>
              <p className={`text-lg font-bold ${"valueColor" in m && m.valueColor ? m.valueColor : "text-white"}`}>
                {m.value}
              </p>
              {"subtitle" in m && m.subtitle && (
                <p className={`text-xs mt-0.5 ${isPositive ? "text-green-400" : "text-red-400"}`}>
                  {m.subtitle}
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
