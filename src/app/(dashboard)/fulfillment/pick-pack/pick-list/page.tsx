"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Printer, CheckCircle } from "lucide-react";
import type { PickListItem } from "@/lib/fulfillment/types";
import { playSuccess, playError } from "@/lib/fulfillment/audio";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";

export default function PickListPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const orderIds = searchParams.get("orders") || "";
  const store = searchParams.get("store") || "ALL";

  const [items, setItems] = useState<PickListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedItems, setScannedItems] = useState<Map<string, number>>(
    new Map()
  );
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  const fetchPickList = useCallback(async () => {
    if (!orderIds) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ orders: orderIds, store });
      const res = await fetch(`/api/shopify/fulfillment/pick-list?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setItems(json.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pick list");
    } finally {
      setLoading(false);
    }
  }, [orderIds, store]);

  useEffect(() => {
    fetchPickList();
  }, [fetchPickList]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) =>
      (a.bin_code || "ZZZ").localeCompare(b.bin_code || "ZZZ")
    );
  }, [items]);

  const totalNeeded = useMemo(
    () => items.reduce((sum, i) => sum + i.total_qty, 0),
    [items]
  );
  const totalPicked = useMemo(() => {
    let sum = 0;
    for (const item of items) {
      sum += Math.min(scannedItems.get(item.sku) || 0, item.total_qty);
    }
    return sum;
  }, [items, scannedItems]);

  const orderCount = orderIds ? orderIds.split(",").length : 0;
  const progressPercent =
    totalNeeded > 0 ? Math.round((totalPicked / totalNeeded) * 100) : 0;

  function handleScan(value: string) {
    const trimmed = value.trim();
    const match = items.find(
      (i) =>
        i.sku?.toLowerCase() === trimmed.toLowerCase() ||
        i.barcode?.toLowerCase() === trimmed.toLowerCase()
    );

    if (!match) {
      playError();
      setFeedback({
        type: "error",
        message: "NOT FOUND",
        subMessage: trimmed,
      });
      return;
    }

    const currentPicked = scannedItems.get(match.sku) || 0;
    if (currentPicked >= match.total_qty) {
      setFeedback({
        type: "warning",
        message: "ALREADY PICKED",
        subMessage: `${match.product_title} (${match.sku})`,
      });
      return;
    }

    playSuccess();
    setScannedItems((prev) => {
      const next = new Map(prev);
      next.set(match.sku, currentPicked + 1);
      return next;
    });
    setFeedback({
      type: "success",
      message: match.product_title,
      subMessage: `${currentPicked + 1}/${match.total_qty}`,
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/fulfillment/pick-pack")}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Pick List</h1>
            <p className="text-gray-400 mt-1">
              {orderCount} order{orderCount !== 1 ? "s" : ""},{" "}
              {totalNeeded} items total
            </p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer print:hidden"
        >
          <Printer size={14} />
          Print
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Scanner */}
      <div className="mb-4 print:hidden">
        <BarcodeScannerInput
          onScan={handleScan}
          placeholder="Scan item to pick..."
        />
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-400">
            {totalPicked}/{totalNeeded} items picked
          </span>
          <span className="text-gray-400">{progressPercent}%</span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Pick list table */}
      {!loading && sortedItems.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50">
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Bin
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  SKU
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Product
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Needed
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Picked
                </th>
                <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, idx) => {
                const picked = scannedItems.get(item.sku) || 0;
                const done = picked >= item.total_qty;
                return (
                  <tr
                    key={item.sku}
                    className={`border-b border-gray-800 ${
                      done
                        ? "bg-emerald-900/10 opacity-60"
                        : idx % 2 === 0
                          ? "bg-gray-900/20"
                          : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-300 font-mono whitespace-nowrap">
                      {item.bin_code || "---"}
                    </td>
                    <td className="px-4 py-3 text-white font-mono whitespace-nowrap">
                      {item.sku}
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {item.product_title}
                      {item.variant_title && (
                        <span className="text-gray-500 ml-1">
                          / {item.variant_title}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                      {item.total_qty}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium whitespace-nowrap ${
                        done
                          ? "text-emerald-400"
                          : picked > 0
                            ? "text-yellow-400"
                            : "text-gray-500"
                      }`}
                    >
                      {picked}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {done ? (
                        <CheckCircle
                          size={16}
                          className="text-emerald-400 inline"
                        />
                      ) : picked > 0 ? (
                        <span className="text-yellow-400 text-xs font-medium">
                          In progress
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sortedItems.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No items in pick list</p>
        </div>
      )}

      {/* Scan feedback overlay */}
      <ScanFeedback
        type={feedback.type}
        message={feedback.message}
        subMessage={feedback.subMessage}
        onDismiss={() => setFeedback({ type: null, message: "" })}
      />

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          table {
            border-collapse: collapse;
          }
          th,
          td {
            border: 1px solid #ccc;
            color: black !important;
            background: white !important;
          }
        }
      `}</style>
    </div>
  );
}
