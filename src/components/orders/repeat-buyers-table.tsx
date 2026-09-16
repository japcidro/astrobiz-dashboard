import { ChevronUp, ChevronDown, Store } from "lucide-react";
import type { RepeatBuyer, RepeatBuyerSort } from "@/lib/shopify/repeat-buyers";

interface Props {
  buyers: RepeatBuyer[];
  sortKey: RepeatBuyerSort;
  sortDir: "asc" | "desc";
  onSort: (key: RepeatBuyerSort) => void;
  onSelectBuyer: (buyer: RepeatBuyer) => void;
}

const COLUMNS: {
  key: RepeatBuyerSort;
  label: string;
  align?: "right";
  title?: string;
}[] = [
  { key: "customer_name", label: "Customer" },
  {
    key: "orders_count",
    label: "Delivered",
    align: "right",
    title: "Orders J&T actually handed over — the only ones counted",
  },
  {
    key: "rts_count",
    label: "RTS",
    align: "right",
    title: "Parcels returned to sender, with this buyer's return rate",
  },
  { key: "total_units", label: "Units", align: "right" },
  { key: "total_spent", label: "Total Spent", align: "right" },
  { key: "avg_order_value", label: "AOV", align: "right" },
  {
    key: "avg_days_between",
    label: "Reorder Gap",
    align: "right",
    title: "Average days between this buyer's orders",
  },
  { key: "first_order_at", label: "First Order" },
  { key: "last_order_at", label: "Last Order" },
  {
    key: "days_since_last",
    label: "Since Last",
    align: "right",
    title: "Days since their most recent order",
  },
];

function formatCurrency(val: number) {
  return `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

// Orders that haven't resolved yet: still moving, not yet uploaded, or killed
// in Shopify. Shown as a hint next to the delivered count, never counted.
function pendingCount(buyer: RepeatBuyer): number {
  return (
    buyer.in_transit_count + buyer.unverified_count + buyer.cancelled_count
  );
}

// A fifth of parcels coming back is the line where a reseller stops paying for
// itself once shipping is counted.
function rtsTone(rate: number | null): string {
  if (rate === null) return "text-gray-300";
  if (rate >= 35) return "text-red-400 font-medium";
  if (rate >= 20) return "text-yellow-400";
  return "text-gray-300";
}

// Green while the buyer is still inside their own rhythm, amber once they have
// gone one gap past due, red at two — a reseller going quiet is a lost account.
function staleTone(daysSinceLast: number, avgGap: number | null): string {
  if (avgGap === null || avgGap <= 0) return "text-gray-300";
  if (daysSinceLast > avgGap * 2) return "text-red-400";
  if (daysSinceLast > avgGap) return "text-yellow-400";
  return "text-green-400";
}

export function RepeatBuyersTable({
  buyers,
  sortKey,
  sortDir,
  onSort,
  onSelectBuyer,
}: Props) {
  if (buyers.length === 0) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
        <p className="text-gray-400">No repeat buyers in this window.</p>
        <p className="text-gray-600 text-sm mt-1">
          Try a longer window or lower the minimum order count.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/80 border-b border-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                Stores
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => onSort(col.key)}
                  className={`px-4 py-3 text-xs font-medium text-gray-400 cursor-pointer hover:text-white select-none whitespace-nowrap ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <span
                    className={`inline-flex items-center gap-1 ${
                      col.align === "right" ? "flex-row-reverse" : ""
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key &&
                      (sortDir === "asc" ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => (
              <tr
                key={buyer.key}
                onClick={() => onSelectBuyer(buyer)}
                className="border-b border-gray-800 last:border-0 hover:bg-white/5 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap max-w-[160px]">
                    {buyer.stores.map((store) => (
                      <span
                        key={store}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700/50 text-gray-300 whitespace-nowrap"
                      >
                        {store}
                      </span>
                    ))}
                  </div>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">
                      {buyer.customer_name}
                    </span>
                    {buyer.is_reseller_candidate && (
                      <span
                        title={buyer.reseller_reasons.join(" · ")}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/40 text-purple-300 whitespace-nowrap"
                      >
                        <Store size={10} />
                        Reseller?
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {buyer.phones[0] || buyer.emails[0] || "no contact on file"}
                    {buyer.stores.length > 1 && (
                      <span className="text-purple-400">
                        {" "}
                        · {buyer.stores.length} brands
                      </span>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3 text-right text-white font-medium">
                  {buyer.orders_count}
                  {pendingCount(buyer) > 0 && (
                    <span
                      className="text-xs text-gray-500 ml-1"
                      title={`${buyer.in_transit_count} in transit, ${buyer.unverified_count} with no parcel on file, ${buyer.cancelled_count} cancelled — none counted`}
                    >
                      +{pendingCount(buyer)}?
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {buyer.rts_count === 0 ? (
                    <span className="text-gray-600">—</span>
                  ) : (
                    <span
                      className={rtsTone(buyer.rts_rate_pct)}
                      title={`${formatCurrency(buyer.rts_value)} worth of parcels came back`}
                    >
                      {buyer.rts_count}
                      {buyer.rts_rate_pct !== null && (
                        <span className="text-xs ml-1">
                          ({buyer.rts_rate_pct}%)
                        </span>
                      )}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-right text-gray-300">
                  {buyer.total_units}
                  <span className="text-xs text-gray-600 ml-1">
                    ({buyer.avg_units_per_order}/order)
                  </span>
                </td>

                <td className="px-4 py-3 text-right text-white font-medium whitespace-nowrap">
                  {formatCurrency(buyer.total_spent)}
                </td>

                <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                  {formatCurrency(buyer.avg_order_value)}
                </td>

                <td className="px-4 py-3 text-right text-gray-300">
                  {buyer.avg_days_between === null
                    ? "—"
                    : `${buyer.avg_days_between}d`}
                </td>

                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                  {formatShortDate(buyer.first_order_at)}
                </td>

                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {formatShortDate(buyer.last_order_at)}
                </td>

                <td
                  className={`px-4 py-3 text-right font-medium ${staleTone(
                    buyer.days_since_last,
                    buyer.avg_days_between
                  )}`}
                >
                  {buyer.days_since_last}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
