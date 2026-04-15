"use client";

import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, CheckCircle, Package, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { VerifyItem, UnfulfilledOrder } from "@/lib/fulfillment/types";
import { playSuccess, playError, playWarning } from "@/lib/fulfillment/audio";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";

type Phase = "scan_order" | "scan_items" | "verified";

export default function VerifyPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("scan_order");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDetails, setOrderDetails] = useState<UnfulfilledOrder | null>(
    null
  );
  const [verifyItems, setVerifyItems] = useState<VerifyItem[]>([]);
  const [fulfilling, setFulfilling] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  // ── Phase 1: Scan or type order number ──

  const handleOrderScan = useCallback(
    async (value: string) => {
      const trimmed = value.trim().replace(/^#/, "");
      setFetchError(null);

      try {
        const res = await fetch(
          `/api/shopify/fulfillment?order=${encodeURIComponent(trimmed)}&store=ALL`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        const orders: UnfulfilledOrder[] = json.orders || [];
        const match = orders.find(
          (o) =>
            o.name.replace("#", "") === trimmed ||
            o.name === `#${trimmed}` ||
            o.name === trimmed
        );

        if (!match) {
          playError();
          setFeedback({
            type: "error",
            message: "ORDER NOT FOUND",
            subMessage: `#${trimmed}`,
          });
          return;
        }

        playSuccess();
        setOrderNumber(match.name);
        setOrderDetails(match);

        const items: VerifyItem[] = match.line_items.map((li) => ({
          sku: li.sku || `NOSKU-${li.id}`,
          barcode: li.barcode,
          title: li.title,
          variant_title: li.variant_title,
          expected_qty: li.quantity,
          scanned_qty: 0,
          status: "pending" as const,
        }));
        setVerifyItems(items);
        setPhase("scan_items");
      } catch (e) {
        playError();
        setFetchError(
          e instanceof Error ? e.message : "Failed to fetch order"
        );
      }
    },
    []
  );

  // ── Phase 2: Scan items to verify ──

  const handleItemScan = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      const matchIdx = verifyItems.findIndex(
        (i) =>
          i.sku?.toLowerCase() === trimmed.toLowerCase() ||
          i.barcode?.toLowerCase() === trimmed.toLowerCase()
      );

      if (matchIdx === -1) {
        playError();
        setFeedback({
          type: "error",
          message: "WRONG ITEM",
          subMessage: trimmed,
        });
        return;
      }

      const item = verifyItems[matchIdx];

      if (item.scanned_qty >= item.expected_qty) {
        playWarning();
        setFeedback({
          type: "warning",
          message: "ALREADY SCANNED",
          subMessage: `Already scanned enough of ${item.title}`,
        });
        return;
      }

      playSuccess();
      setVerifyItems((prev) => {
        const next = [...prev];
        const updated = { ...next[matchIdx] };
        updated.scanned_qty += 1;
        updated.status =
          updated.scanned_qty >= updated.expected_qty ? "matched" : "pending";
        next[matchIdx] = updated;
        return next;
      });

      setFeedback({
        type: "success",
        message: item.title,
        subMessage: `${item.scanned_qty + 1}/${item.expected_qty}`,
      });
    },
    [verifyItems]
  );

  // ── Fulfillment ──

  const allVerified = useMemo(
    () =>
      verifyItems.length > 0 &&
      verifyItems.every((i) => i.scanned_qty >= i.expected_qty),
    [verifyItems]
  );

  const totalExpected = useMemo(
    () => verifyItems.reduce((s, i) => s + i.expected_qty, 0),
    [verifyItems]
  );
  const totalScanned = useMemo(
    () =>
      verifyItems.reduce(
        (s, i) => s + Math.min(i.scanned_qty, i.expected_qty),
        0
      ),
    [verifyItems]
  );
  const progressPercent =
    totalExpected > 0
      ? Math.round((totalScanned / totalExpected) * 100)
      : 0;

  async function handleVerifyComplete() {
    if (!orderDetails || fulfilling) return;
    setFulfilling(true);
    try {
      // Log verification to pack_verifications table (don't call Shopify — BigSeller already fulfilled)
      const res = await fetch("/api/shopify/fulfillment/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: orderDetails.store_id,
          store_name: orderDetails.store_name,
          order_id: String(orderDetails.id),
          order_number: orderDetails.name,
          items_expected: totalExpected,
          items_scanned: totalScanned,
          mismatches: verifyItems
            .filter((i) => i.scanned_qty !== i.expected_qty)
            .map((i) => ({ sku: i.sku, expected: i.expected_qty, scanned: i.scanned_qty })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      setPhase("verified");
      playSuccess();
    } catch (e) {
      setFeedback({
        type: "error",
        message: "SAVE FAILED",
        subMessage: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setFulfilling(false);
    }
  }

  function handleScanNext() {
    setPhase("scan_order");
    setOrderNumber("");
    setOrderDetails(null);
    setVerifyItems([]);
    setFeedback({ type: null, message: "" });
    setFetchError(null);
  }

  // ── Render ──

  return (
    <div>
      {/* Back button (always visible) */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/fulfillment/pick-pack")}
          className="text-gray-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-white">Pack &amp; Verify</h1>
      </div>

      {/* ─── Phase 1: Scan Order ─── */}
      {phase === "scan_order" && (
        <div className="flex flex-col items-center justify-center py-20">
          <Package size={64} className="text-gray-500 mb-6" />
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 text-center">
            Scan Order Barcode
          </h2>
          <p className="text-gray-400 mb-8 text-center">
            Or type order number manually (e.g. 1234)
          </p>
          <div className="w-full max-w-md">
            <BarcodeScannerInput
              onScan={handleOrderScan}
              placeholder="Scan or type order #..."
            />
          </div>
          {fetchError && (
            <p className="mt-4 text-red-400 text-sm">{fetchError}</p>
          )}
        </div>
      )}

      {/* ─── Phase 2: Scan Items ─── */}
      {phase === "scan_items" && orderDetails && (
        <div>
          {/* Order info */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">
              Verifying Order {orderNumber}
            </h2>
            <p className="text-gray-400 text-sm">
              {orderDetails.customer_name} &middot;{" "}
              {orderDetails.store_name}
            </p>
          </div>

          {/* Scanner */}
          <div className="mb-4">
            <BarcodeScannerInput
              onScan={handleItemScan}
              placeholder="Scan item..."
            />
          </div>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-400">
                {totalScanned}/{totalExpected} items verified
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

          {/* Items table */}
          <div className="overflow-x-auto rounded-xl border border-gray-700/50 mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50">
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left w-10">
                    Status
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    SKU
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Product
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Expected
                  </th>
                  <th className="text-gray-400 text-xs uppercase font-medium px-4 py-3 text-left whitespace-nowrap">
                    Scanned
                  </th>
                </tr>
              </thead>
              <tbody>
                {verifyItems.map((item, idx) => {
                  const done = item.scanned_qty >= item.expected_qty;
                  return (
                    <tr
                      key={item.sku}
                      className={`border-b border-gray-800 ${
                        done
                          ? "bg-emerald-900/10"
                          : idx % 2 === 0
                            ? "bg-gray-900/20"
                            : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        {done ? (
                          <CheckCircle
                            size={18}
                            className="text-emerald-400"
                          />
                        ) : (
                          <XCircle size={18} className="text-gray-600" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-white font-mono whitespace-nowrap">
                        {item.sku}
                      </td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                        {item.title}
                        {item.variant_title && (
                          <span className="text-gray-500 ml-1">
                            / {item.variant_title}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                        {item.expected_qty}
                      </td>
                      <td
                        className={`px-4 py-3 font-medium whitespace-nowrap ${
                          done
                            ? "text-emerald-400"
                            : item.scanned_qty > 0
                              ? "text-yellow-400"
                              : "text-gray-500"
                        }`}
                      >
                        {item.scanned_qty}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Fulfill button */}
          {allVerified && (
            <button
              onClick={handleVerifyComplete}
              disabled={fulfilling}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              {fulfilling ? "Saving..." : "Confirm Packed ✓"}
            </button>
          )}
        </div>
      )}

      {/* ─── Phase 3: Verified ─── */}
      {phase === "verified" && (
        <div className="flex flex-col items-center justify-center py-20">
          <CheckCircle size={80} className="text-emerald-400 mb-6" />
          <h2 className="text-3xl md:text-4xl font-bold text-emerald-400 mb-2 text-center">
            Order {orderNumber} Verified &amp; Packed
          </h2>
          <p className="text-gray-400 mb-8">
            {totalScanned}/{totalExpected} items confirmed
          </p>
          <button
            onClick={handleScanNext}
            className="bg-white text-gray-900 font-semibold py-3 px-8 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Scan Next Order
          </button>
        </div>
      )}

      {/* Scan feedback overlay */}
      <ScanFeedback
        type={feedback.type}
        message={feedback.message}
        subMessage={feedback.subMessage}
        onDismiss={() => setFeedback({ type: null, message: "" })}
      />
    </div>
  );
}
