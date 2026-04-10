import {
  Package,
  Layers,
  XCircle,
  AlertTriangle,
  Archive,
} from "lucide-react";
import type { InventorySummary } from "@/lib/shopify/types";

interface Props {
  summary: InventorySummary;
  loading: boolean;
}

export function InventorySummaryCards({ summary, loading }: Props) {
  const metrics = [
    {
      label: "Total Products",
      value: summary.total_products.toLocaleString(),
      icon: <Package size={20} className="text-blue-400" />,
      bg: "bg-blue-600/20",
    },
    {
      label: "Total Variants",
      value: summary.total_variants.toLocaleString(),
      icon: <Layers size={20} className="text-purple-400" />,
      bg: "bg-purple-600/20",
    },
    {
      label: "Out of Stock",
      value: summary.out_of_stock_count.toLocaleString(),
      icon: <XCircle size={20} className="text-red-400" />,
      bg: "bg-red-600/20",
      accent: summary.out_of_stock_count > 0 ? "border-red-700/50" : "",
    },
    {
      label: "Low Stock (<10)",
      value: summary.low_stock_count.toLocaleString(),
      icon: <AlertTriangle size={20} className="text-yellow-400" />,
      bg: "bg-yellow-600/20",
      accent: summary.low_stock_count > 0 ? "border-yellow-700/50" : "",
    },
    {
      label: "Total Units",
      value: summary.total_units.toLocaleString(),
      icon: <Archive size={20} className="text-green-400" />,
      bg: "bg-green-600/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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
            <p className="text-lg font-bold text-white">{m.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
