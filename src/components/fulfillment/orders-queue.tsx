"use client";

import { useState, useMemo } from "react";
import { Package } from "lucide-react";
import type { UnfulfilledOrder } from "@/lib/fulfillment/types";

interface Props {
  orders: UnfulfilledOrder[];
  onGeneratePickList: (orderIds: number[]) => void;
  loading: boolean;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
}

function AgeBadge({ days }: { days: number }) {
  const cls =
    days >= 5
      ? "text-red-400 font-semibold"
      : days >= 3
        ? "text-yellow-400"
        : "text-white";
  return <span className={cls}>{days}d</span>;
}

export function OrdersQueue({ orders, onGeneratePickList, loading }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allIds = useMemo(() => orders.map((o) => o.id), [orders]);

  const allSelected = orders.length > 0 && selected.size === orders.length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return null;
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Package size={40} className="mx-auto mb-3 opacity-50" />
        <p className="text-lg">No unfulfilled orders</p>
        <p className="text-sm mt-1">All caught up!</p>
      </div>
    );
  }

  return (
    <div>
      {/* Selection bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400">
          {selected.size > 0
            ? `${selected.size} order${selected.size !== 1 ? "s" : ""} selected`
            : `${orders.length} unfulfilled order${orders.length !== 1 ? "s" : ""}`}
        </p>
        <button
          onClick={() => onGeneratePickList(Array.from(selected))}
          disabled={selected.size === 0}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Generate Pick List
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800/50">
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                />
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Order #
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Store
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Customer
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Items
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Age
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, idx) => (
              <tr
                key={order.id}
                className={`border-b border-gray-800 hover:bg-gray-800/30 cursor-pointer ${
                  idx % 2 === 0 ? "bg-gray-900/20" : ""
                } ${selected.has(order.id) ? "bg-emerald-900/10" : ""}`}
                onClick={() => toggle(order.id)}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                  {order.name}
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.store_name}
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.customer_name}
                </td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {order.item_count}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <AgeBadge days={order.age_days} />
                </td>
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                  {formatDate(order.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
