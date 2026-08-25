import { ChevronUp, ChevronDown } from "lucide-react";
import type { DailyPnlRow } from "@/lib/profit/types";
import { formatOrderCount } from "@/lib/profit/format";

interface Props {
  rows: DailyPnlRow[];
  totals: DailyPnlRow;
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
}

const COLUMNS: { key: string; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "revenue", label: "Revenue" },
  { key: "order_count", label: "Orders" },
  { key: "cogs", label: "COGS" },
  { key: "ad_spend", label: "Ad Spend" },
  { key: "shipping", label: "Shipping" },
  { key: "returns_value", label: "Returns" },
  { key: "aov", label: "AOV" },
  { key: "cpp", label: "CPP" },
  { key: "net_profit", label: "Net Profit" },
  { key: "margin_pct", label: "Margin %" },
];

function formatCurrency(val: number) {
  return `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function profitColor(val: number) {
  return val >= 0 ? "text-green-400" : "text-red-400";
}

function renderCell(key: string, row: DailyPnlRow) {
  switch (key) {
    case "date":
      return formatDate(row.date);
    case "order_count":
      return formatOrderCount(row.order_count);
    case "revenue":
      return (
        <span>
          {formatCurrency(row.revenue)}
          {row.void_adjusted && (
            <span
              className="text-yellow-400 text-xs ml-1.5"
              title="Revenue held back for cancellations that haven't landed yet — unconfirmed leads are deleted after 3+ days"
            >
              (adj)
            </span>
          )}
        </span>
      );
    case "cogs":
    case "ad_spend":
    case "aov":
    case "cpp":
      return formatCurrency(row[key]);
    case "returns_value":
      return (
        <span>
          {formatCurrency(row.returns_value)}
          {row.in_transit_count > 0 && (
            <span className="text-yellow-400 text-xs ml-1.5" title={`${row.in_transit_count} parcels still in transit — returns not yet final`}>
              ({row.in_transit_count} in transit)
            </span>
          )}
        </span>
      );
    case "shipping":
      return (
        <span className={row.shipping_projected ? "text-yellow-400" : ""}>
          {formatCurrency(row.shipping)}
          {row.shipping_projected && (
            <span
              className="text-xs ml-1.5"
              title="Some of this day's orders have no J&T parcel on file yet — the gap is estimated at the store's average fee"
            >
              (est)
            </span>
          )}
        </span>
      );
    case "net_profit":
      return (
        <span className={profitColor(row.net_profit)}>
          {formatCurrency(row.net_profit)}
        </span>
      );
    case "margin_pct":
      return (
        <span className={profitColor(row.margin_pct)}>
          {row.margin_pct.toFixed(1)}%
        </span>
      );
    default:
      return "";
  }
}

export function ProfitDailyTable({ rows, totals, sortKey, sortDir, onSort }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg">No data for this period</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-800/50">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none"
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === "asc" ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Totals row - fixed at top */}
          <tr className="bg-gray-800 font-bold border-b border-gray-700">
            {COLUMNS.map((col) => (
              <td key={col.key} className="px-4 py-3 whitespace-nowrap text-white">
                {col.key === "date" ? "Total" : renderCell(col.key, totals)}
              </td>
            ))}
          </tr>

          {/* Data rows */}
          {rows.map((row, idx) => (
            <tr
              key={row.date}
              className={`border-b border-gray-800 hover:bg-gray-800/30 ${
                idx % 2 === 0 ? "bg-gray-900/20" : ""
              }`}
            >
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 whitespace-nowrap ${
                    col.key === "date" ? "font-medium text-white" : "text-gray-300"
                  }`}
                >
                  {renderCell(col.key, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
