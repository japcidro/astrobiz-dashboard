import { ChevronUp, ChevronDown } from "lucide-react";
import type { DailyPnlRow } from "@/lib/profit/types";
import { formatOrderCount } from "@/lib/profit/format";
import { calculateBestCaseNetProfit } from "@/lib/profit/formulas";
import { formatJtAsOf, isJtDataStale } from "@/lib/profit/freshness";

interface Props {
  rows: DailyPnlRow[];
  totals: DailyPnlRow;
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  /** When the J&T parcel statuses were last uploaded; in-transit figures are as of then. */
  jtDataAsOf?: string | null;
}

/** What a cell needs to know beyond its own row. */
interface CellContext {
  jtDataAsOf: string | null;
  /** The last upload is old enough that open parcels have probably settled since. */
  jtStale: boolean;
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

/**
 * What the returns figure is made of, for the tooltip. The number itself is
 * J&T fact plus two kinds of estimate, and a reader deciding whether a day
 * is really negative needs to know which part is which.
 */
function returnsBreakdown(row: DailyPnlRow, ctx: CellContext): string {
  const parts: string[] = [];
  const actual = row.returns_actual ?? 0;
  const inTransit = row.returns_in_transit_est ?? 0;
  const unshipped = row.returns_unshipped_est ?? 0;
  parts.push(`${formatCurrency(actual)} confirmed returned by J&T`);
  if (row.in_transit_count > 0) {
    parts.push(
      `${formatCurrency(inTransit)} expected from ${row.in_transit_count} parcel${row.in_transit_count === 1 ? "" : "s"} still in transit (each × its chance of coming back, by region and days out)` +
        (ctx.jtDataAsOf ? `; status as of the ${formatJtAsOf(ctx.jtDataAsOf)} upload` : "")
    );
  }
  if (unshipped > 0) {
    parts.push(`${formatCurrency(unshipped)} expected for orders that have no J&T parcel yet`);
  }
  return parts.join("\n");
}

function isProjected(row: DailyPnlRow): boolean {
  return row.shipping_projected || row.returns_projected || row.void_adjusted;
}

function renderCell(key: string, row: DailyPnlRow, ctx: CellContext) {
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
    case "returns_value": {
      const unshippedOnly = row.in_transit_count === 0 && (row.returns_unshipped_est ?? 0) > 0;
      return (
        <span title={returnsBreakdown(row, ctx)}>
          {formatCurrency(row.returns_value)}
          {row.in_transit_count > 0 && (
            <span className="text-yellow-400 text-xs ml-1.5">
              ({row.in_transit_count} in transit
              {ctx.jtStale && ctx.jtDataAsOf
                ? ` as of ${formatJtAsOf(ctx.jtDataAsOf, { dateOnly: true })}`
                : ""}
              )
            </span>
          )}
          {unshippedOnly && (
            <span className="text-yellow-400 text-xs ml-1.5">(est)</span>
          )}
        </span>
      );
    }
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
    case "net_profit": {
      const projected = isProjected(row);
      const bestCase = calculateBestCaseNetProfit(
        row.net_profit,
        row.returns_in_transit_est,
        row.returns_unshipped_est
      );
      // Only worth a line when estimates are actually holding the figure down.
      const showBestCase = projected && bestCase - row.net_profit >= 0.005;
      return (
        <span className="inline-flex flex-col">
          <span
            className={profitColor(row.net_profit)}
            title={
              projected
                ? "Projected — revenue, COGS and ad spend are actual; shipping and returns include estimates for parcels still moving or not yet shipped. Final once every parcel is delivered or returned."
                : "Final — every parcel for this day is delivered or returned"
            }
          >
            {projected && <span className="text-gray-500 mr-0.5">≈</span>}
            {formatCurrency(row.net_profit)}
          </span>
          {showBestCase && (
            <span
              className="text-xs font-normal text-gray-500"
              title="If every parcel still in transit delivers and every unshipped order ships and delivers. Confirmed returns and the cancellation holdback stay. The ≈ figure is the expected outcome; the day lands between a worse case and this."
            >
              up to {formatCurrency(bestCase)} if all deliver
            </span>
          )}
        </span>
      );
    }
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

export function ProfitDailyTable({ rows, totals, sortKey, sortDir, onSort, jtDataAsOf }: Props) {
  const ctx: CellContext = {
    jtDataAsOf: jtDataAsOf ?? null,
    jtStale: isJtDataStale(jtDataAsOf),
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg">No data for this period</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-panel">
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
                {col.key === "date" ? "Total" : renderCell(col.key, totals, ctx)}
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
                  {renderCell(col.key, row, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
