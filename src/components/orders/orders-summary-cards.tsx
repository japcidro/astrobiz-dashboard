import {
  Package,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import type { OrdersSummary } from "@/lib/shopify/types";

interface Props {
  summary: OrdersSummary;
  loading: boolean;
}

export function OrdersSummaryCards({ summary, loading }: Props) {
  const formatCurrency = (val: number) =>
    `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatNumber = (val: number) => val.toLocaleString("en-PH");

  const formatHours = (val: number | null) => {
    if (val === null) return "N/A";
    if (val < 1) return `${Math.round(val * 60)}m`;
    return `${val.toFixed(1)}h`;
  };

  const agingTotal = summary.aging_warning_count + summary.aging_danger_count;
  const hasAgingDanger = summary.aging_danger_count > 0;
  const hasAgingWarning = summary.aging_warning_count > 0;

  const metrics = [
    {
      label: "Total Orders",
      value: formatNumber(summary.total_orders),
      icon: <Package size={20} className="text-blue-400" />,
      bg: "bg-blue-600/20",
      accent: "",
    },
    {
      label: "Revenue",
      value: formatCurrency(summary.total_revenue),
      icon: <DollarSign size={20} className="text-green-400" />,
      bg: "bg-green-600/20",
      accent: "",
    },
    {
      label: "Unfulfilled",
      value: formatNumber(summary.unfulfilled_count),
      subtitle: agingTotal > 0 ? `(${agingTotal} aging)` : undefined,
      icon: (
        <AlertTriangle
          size={20}
          className={
            hasAgingDanger
              ? "text-red-400"
              : hasAgingWarning
                ? "text-yellow-400"
                : "text-yellow-400"
          }
        />
      ),
      bg: hasAgingDanger
        ? "bg-red-600/20"
        : hasAgingWarning
          ? "bg-yellow-600/20"
          : "bg-yellow-600/20",
      accent: hasAgingDanger
        ? "border-red-700/50"
        : hasAgingWarning
          ? "border-yellow-700/50"
          : "",
    },
    {
      label: "Fulfilled",
      value: formatNumber(summary.fulfilled_count),
      icon: <CheckCircle size={20} className="text-green-400" />,
      bg: "bg-green-600/20",
      accent: "",
    },
    {
      label: "Cancelled",
      value: formatNumber(summary.cancelled_count),
      icon: <XCircle size={20} className="text-red-400" />,
      bg: "bg-red-600/20",
      accent: "",
    },
    {
      label: "Avg Fulfillment",
      value: formatHours(summary.avg_fulfillment_hours),
      icon: <Clock size={20} className="text-purple-400" />,
      bg: "bg-purple-600/20",
      accent: "",
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
              <p className="text-lg font-bold text-white">{m.value}</p>
              {"subtitle" in m && m.subtitle && (
                <p
                  className={`text-xs mt-0.5 ${
                    hasAgingDanger ? "text-red-400" : "text-yellow-400"
                  }`}
                >
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
