import { Users, Repeat, Package, Store, CalendarClock } from "lucide-react";
import {
  RESELLER_BULK_ORDER_UNITS,
  RESELLER_MIN_ORDERS,
  RESELLER_MIN_UNITS,
  type RepeatBuyersSummary,
} from "@/lib/shopify/repeat-buyers";

const RESELLER_HINT = `${RESELLER_MIN_ORDERS}+ orders, ${RESELLER_MIN_UNITS}+ units, or a ${RESELLER_BULK_ORDER_UNITS}-unit order`;

interface Props {
  summary: RepeatBuyersSummary;
  loading: boolean;
}

function formatCurrency(val: number) {
  return `₱${val.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatNumber(val: number) {
  return val.toLocaleString("en-PH");
}

export function RepeatBuyersSummaryCards({ summary, loading }: Props) {
  const metrics = [
    {
      label: "Repeat Buyers",
      value: formatNumber(summary.repeat_buyers),
      subtitle: `${summary.repeat_rate_pct}% of ${formatNumber(summary.total_buyers)} buyers`,
      icon: <Repeat size={20} className="text-blue-400" />,
      bg: "bg-blue-600/20",
    },
    {
      label: "Reseller Candidates",
      value: formatNumber(summary.reseller_candidates),
      subtitle: RESELLER_HINT,
      icon: <Store size={20} className="text-purple-400" />,
      bg: "bg-purple-600/20",
    },
    {
      label: "Repeat Revenue",
      value: formatCurrency(summary.repeat_revenue),
      subtitle: `${summary.repeat_revenue_pct}% of ${formatCurrency(summary.total_revenue)}`,
      icon: (
        <span className="text-green-400 font-bold text-lg leading-none">₱</span>
      ),
      bg: "bg-green-600/20",
    },
    {
      label: "Units Repurchased",
      value: formatNumber(summary.repeat_units),
      subtitle: `${formatNumber(summary.repeat_orders)} orders`,
      icon: <Package size={20} className="text-amber-400" />,
      bg: "bg-amber-600/20",
    },
    {
      label: "Avg per Repeat Buyer",
      value: formatCurrency(summary.avg_repeat_buyer_value),
      subtitle: `${summary.avg_orders_per_repeat_buyer} orders each`,
      icon: <Users size={20} className="text-cyan-400" />,
      bg: "bg-cyan-600/20",
    },
    {
      label: "Avg Reorder Gap",
      value:
        summary.avg_days_between_orders === null
          ? "N/A"
          : `${summary.avg_days_between_orders}d`,
      subtitle: `over ${summary.window_days} days`,
      icon: <CalendarClock size={20} className="text-pink-400" />,
      bg: "bg-pink-600/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
            <>
              <p className="text-lg font-bold text-white">{m.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{m.subtitle}</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
