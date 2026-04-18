"use client";

import { useState, useMemo } from "react";
import { Package, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import type { UnfulfilledOrder } from "@/lib/fulfillment/types";

interface Props {
  orders: UnfulfilledOrder[];
  stockMap: Map<string, number>;
  onGeneratePickList: (orderIds: number[]) => void;
  onMarkPacked: (orderIds: number[]) => void;
  loading: boolean;
  resetSignal?: number;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

function AgeBadge({ days }: { days: number }) {
  const cls = days >= 5 ? "text-red-400 font-semibold" : days >= 3 ? "text-yellow-400" : "text-white";
  return <span className={cls}>{days}d</span>;
}

function StockBadge({ order, stockMap }: { order: UnfulfilledOrder; stockMap: Map<string, number> }) {
  let allInStock = true;
  let outOfStockCount = 0;
  let lowStockCount = 0;

  for (const li of order.line_items) {
    if (!li.sku) continue;
    const skuKey = li.sku.toLowerCase();
    const available = stockMap.get(skuKey) || 0;
    if (available < li.quantity) {
      if (available === 0) outOfStockCount++;
      else lowStockCount++;
      allInStock = false;
    }
  }

  if (allInStock) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-400">
        <CheckCircle size={12} />
        In Stock
      </span>
    );
  }

  if (outOfStockCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400" title={`${outOfStockCount} item(s) out of stock`}>
        <XCircle size={12} />
        {outOfStockCount} OOS
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-yellow-400" title={`${lowStockCount} item(s) low stock`}>
      <AlertTriangle size={12} />
      Low
    </span>
  );
}

export function OrdersQueue({
  orders,
  stockMap,
  onGeneratePickList,
  onMarkPacked,
  loading,
  resetSignal = 0,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastReset, setLastReset] = useState(resetSignal);
  if (lastReset !== resetSignal) {
    setLastReset(resetSignal);
    setSelected(new Set());
  }
  const allIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const allSelected = orders.length > 0 && selected.size === orders.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedStockIssues = useMemo(() => {
    let issues = 0;
    for (const order of orders) {
      if (!selected.has(order.id)) continue;
      for (const li of order.line_items) {
        if (!li.sku) continue;
        const available = stockMap.get(li.sku.toLowerCase()) || 0;
        if (available < li.quantity) issues++;
      }
    }
    return issues;
  }, [orders, selected, stockMap]);

  if (loading) return null;

  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Package size={40} className="mx-auto mb-3 opacity-50" />
        <p className="text-lg">No orders to pack</p>
        <p className="text-sm mt-1">All orders verified and packed!</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm text-gray-400">
            {selected.size > 0
              ? `${selected.size} order${selected.size !== 1 ? "s" : ""} selected`
              : `${orders.length} order${orders.length !== 1 ? "s" : ""}`}
          </p>
          {selectedStockIssues > 0 && selected.size > 0 && (
            <p className="text-xs text-yellow-400 mt-0.5">
              ⚠ {selectedStockIssues} item(s) in selected orders have stock issues
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onMarkPacked(Array.from(selected))}
            disabled={selected.size === 0}
            title="Remove selected orders from this list (logged in audit trail)"
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Mark as Already Packed
          </button>
          <button
            onClick={() => onGeneratePickList(Array.from(selected))}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Generate Pick List
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800/50">
              <th className="px-4 py-3 text-left w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
              </th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Order #</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Store</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Customer</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Items</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Stock</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Age</th>
              <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, idx) => (
              <tr key={order.id}
                className={`border-b border-gray-800 hover:bg-gray-800/30 cursor-pointer ${
                  idx % 2 === 0 ? "bg-gray-900/20" : ""
                } ${selected.has(order.id) ? "bg-emerald-900/10" : ""}`}
                onClick={() => toggle(order.id)}
              >
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)} onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                </td>
                <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{order.name}</td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{order.store_name}</td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{order.customer_name}</td>
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{order.item_count}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StockBadge order={order} stockMap={stockMap} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap"><AgeBadge days={order.age_days} /></td>
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDate(order.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
