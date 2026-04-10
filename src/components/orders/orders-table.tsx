import { ChevronUp, ChevronDown } from "lucide-react";
import type { ShopifyOrder } from "@/lib/shopify/types";

interface Props {
  orders: ShopifyOrder[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  isAdmin: boolean;
}

const ALL_COLUMNS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: "name", label: "Order #" },
  { key: "store_name", label: "Store" },
  { key: "customer_name", label: "Customer" },
  { key: "total_price", label: "Total (₱)", adminOnly: true },
  { key: "financial_status", label: "Payment" },
  { key: "fulfillment_status", label: "Fulfillment" },
  { key: "age_days", label: "Age" },
  { key: "province", label: "Province" },
  { key: "created_at", label: "Date" },
];

function formatCurrency(val: string) {
  const num = parseFloat(val);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }) +
    ", " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
}

function PaymentBadge({ status, isCod }: { status: string; isCod: boolean }) {
  if (isCod) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-900/30 text-blue-400">
        COD
      </span>
    );
  }

  const styles: Record<string, string> = {
    paid: "bg-green-900/30 text-green-400",
    pending: "bg-yellow-900/30 text-yellow-400",
    refunded: "bg-red-900/30 text-red-400",
    partially_refunded: "bg-red-900/30 text-red-400",
    voided: "bg-red-900/30 text-red-400",
  };

  const cls = styles[status] || "bg-gray-700/50 text-gray-400";
  const label = status.replace(/_/g, " ");

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}

function FulfillmentBadge({ status }: { status: string | null }) {
  if (status === null || status === "unfulfilled") {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400">
        Unfulfilled
      </span>
    );
  }
  if (status === "fulfilled") {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400">
        Fulfilled
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400">
        Partial
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400 capitalize">
      {status}
    </span>
  );
}

function AgeBadge({
  days,
  level,
  isUnfulfilled,
}: {
  days: number;
  level: "normal" | "warning" | "danger";
  isUnfulfilled: boolean;
}) {
  if (!isUnfulfilled) {
    return <span className="text-gray-500">{days}d</span>;
  }

  const cls =
    level === "danger"
      ? "text-red-400 font-semibold"
      : level === "warning"
        ? "text-yellow-400"
        : "text-white";

  return <span className={cls}>{days}d</span>;
}

export function OrdersTable({ orders, sortKey, sortDir, onSort, isAdmin }: Props) {
  const COLUMNS = ALL_COLUMNS.filter((c) => !c.adminOnly || isAdmin);
  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg">No orders found</p>
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
          {orders.map((order, idx) => {
            const isUnfulfilled =
              order.fulfillment_status === null ||
              order.fulfillment_status === "unfulfilled";
            return (
              <tr
                key={order.id}
                className={`border-b border-gray-800 hover:bg-gray-800/30 ${
                  idx % 2 === 0 ? "bg-gray-900/20" : ""
                }`}
              >
                <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                  {order.name}
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.store_name}
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.customer_name}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                    {formatCurrency(order.total_price)}
                  </td>
                )}
                <td className="px-4 py-3 whitespace-nowrap">
                  <PaymentBadge
                    status={order.financial_status}
                    isCod={order.is_cod}
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <FulfillmentBadge status={order.fulfillment_status} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <AgeBadge
                    days={order.age_days}
                    level={order.age_level}
                    isUnfulfilled={isUnfulfilled}
                  />
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.province || "—"}
                </td>
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                  {formatDate(order.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
