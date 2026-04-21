"use client";

import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, CheckCircle, Package, XCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { VerifyItem, UnfulfilledOrder } from "@/lib/fulfillment/types";
import { playSuccess, playError, playWarning } from "@/lib/fulfillment/audio";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";
import { KNOWN_STORES } from "@/lib/profit/store-matching";

type Phase = "scan_order" | "scan_items" | "confirm_sender" | "verified";

export default function VerifyPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("scan_order");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDetails, setOrderDetails] = useState<UnfulfilledOrder | null>(
    null
  );
  const [verifyItems, setVerifyItems] = useState<VerifyItem[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [fulfilling, setFulfilling] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedSender, setSelectedSender] = useState<string>("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  // ── Phase 1: Scan or type order number ──

  // Helper to set up order for verification
  const setupOrder = useCallback(async (match: UnfulfilledOrder) => {
    playSuccess();
    setOrderNumber(match.name);
    setOrderDetails(match);

    // Shopify order line_items store the SKU as a snapshot at order-creation
    // time. Fetch current variant SKU/barcode so scans of newly-renamed
    // SKUs match against the current label value.
    const variantIds = Array.from(
      new Set(
        match.line_items
          .map((li) => li.variant_id)
          .filter((v): v is number => typeof v === "number" && v > 0)
      )
    );
    let enriched: Record<string, { sku: string | null; barcode: string | null }> = {};
    if (variantIds.length > 0 && match.store_name) {
      try {
        const res = await fetch(
          `/api/shopify/variants?store=${encodeURIComponent(match.store_name)}&ids=${variantIds.join(",")}`
        );
        if (res.ok) {
          const json = await res.json();
          enriched = json.variants || {};
        }
      } catch {
        // fall back to historical line_item values
      }
    }

    // Merge line items by scan key (SKU, falling back to barcode, falling
    // back to line-item id). The scanner matches by SKU or barcode, so any
    // rows that would match the same scan must be collapsed into one row —
    // otherwise cascading fails (e.g. 3pcs + 2pcs of GLWPTC across two
    // line items must count as 5 scans against one row instead of locking
    // the packer out with "already scanned" after the first 3).
    const merged = new Map<string, VerifyItem>();
    for (const li of match.line_items) {
      const current = enriched[String(li.variant_id)];
      const sku = current?.sku || li.sku || "";
      const barcode = current?.barcode || li.barcode || "";
      const key =
        sku.toLowerCase() ||
        barcode.toLowerCase() ||
        `NOSKU-${li.id}`;
      const existing = merged.get(key);
      if (existing) {
        existing.expected_qty += li.quantity;
      } else {
        merged.set(key, {
          sku: sku || `NOSKU-${li.id}`,
          barcode: barcode || null,
          title: li.title,
          variant_title: li.variant_title,
          expected_qty: li.quantity,
          scanned_qty: 0,
          status: "pending",
        });
      }
    }
    const items: VerifyItem[] = Array.from(merged.values());
    setVerifyItems(items);
    setStartedAt(new Date().toISOString());
    setPhase("scan_items");
  }, []);

  const handleOrderScan = useCallback(
    async (value: string) => {
      const trimmed = value.trim().replace(/^#/, "");
      setFetchError(null);

      try {
        // Fetch all orders that need packing
        const res = await fetch(
          `/api/shopify/fulfillment?store=ALL`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        const orders: UnfulfilledOrder[] = json.orders || [];

        // Try 1: Match by Shopify order name/number
        const nameMatch = orders.find(
          (o) =>
            o.name.replace("#", "") === trimmed ||
            o.name === `#${trimmed}` ||
            o.name === trimmed
        );

        if (nameMatch) {
          await setupOrder(nameMatch);
          return;
        }

        // Try 2: Match by tracking number (waybill) from Shopify fulfillments
        const waybillMatch = orders.find((o) =>
          o.tracking_numbers?.some(
            (tn) => tn.toUpperCase() === trimmed.toUpperCase()
          )
        );

        if (waybillMatch) {
          await setupOrder(waybillMatch);
          return;
        }

        playError();
        setFeedback({
          type: "error",
          message: "ORDER NOT FOUND",
          subMessage: `#${trimmed}`,
        });
      } catch (e) {
        playError();
        setFetchError(
          e instanceof Error ? e.message : "Failed to fetch order"
        );
      }
    },
    [setupOrder]
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
          subMessage: `Scanned: "${trimmed}" (${trimmed.length} chars) — no match in order`,
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
    if (!orderDetails || fulfilling || !selectedSender) return;
    setFulfilling(true);
    try {
      // Log verification to pack_verifications table (don't call Shopify — BigSeller already fulfilled)
      const waybill = orderDetails.tracking_numbers?.[0] ?? null;
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
          started_at: startedAt,
          waybill,
          actual_sender: selectedSender,
          mismatches: verifyItems
            .filter((i) => i.scanned_qty !== i.expected_qty)
            .map((i) => ({ sku: i.sku, expected: i.expected_qty, scanned: i.scanned_qty })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json?.error || `Save failed (HTTP ${res.status})`
        );
      }

      setPhase("verified");
      playSuccess();
    } catch (e) {
      playError();
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
    setStartedAt(null);
    setSelectedSender("");
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
            Scan Waybill or Order #
          </h2>
          <p className="text-gray-400 mb-8 text-center">
            Scan J&T waybill barcode or type order number
          </p>
          <div className="w-full max-w-md">
            <BarcodeScannerInput
              onScan={handleOrderScan}
              placeholder="Scan waybill or order #..."
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
                      key={`${item.sku}__${item.variant_title ?? ""}`}
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

          {/* Proceed to sender confirm */}
          {allVerified && (
            <button
              onClick={() => {
                setSelectedSender(orderDetails?.store_name ?? "");
                setPhase("confirm_sender");
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer"
            >
              Next — Verify Sender →
            </button>
          )}
        </div>
      )}

      {/* ─── Phase 3: Confirm sender on label ─── */}
      {phase === "confirm_sender" && orderDetails && (
        <div className="max-w-2xl mx-auto py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">Verify Sender on Label</h2>
            <p className="text-gray-400 text-sm">
              Order {orderNumber} &middot; {orderDetails.customer_name}
            </p>
          </div>

          {/* Expected sender callout */}
          <div className="mb-6 p-5 bg-emerald-900/20 border border-emerald-700/50 rounded-xl">
            <p className="text-xs uppercase tracking-wide text-emerald-300/80 mb-1">
              Expected sender (from Shopify)
            </p>
            <p className="text-2xl font-bold text-emerald-300">
              {orderDetails.store_name}
            </p>
            {orderDetails.tracking_numbers?.[0] && (
              <p className="text-xs text-gray-400 mt-2 font-mono">
                Waybill: {orderDetails.tracking_numbers[0]}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="text-sm text-gray-400 mb-2 block">
              Ano ang nakasulat sa label?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {KNOWN_STORES.map((store) => {
                const selected = selectedSender === store;
                const expected = orderDetails.store_name === store;
                return (
                  <button
                    key={store}
                    onClick={() => setSelectedSender(store)}
                    className={`px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      selected
                        ? expected
                          ? "bg-emerald-600/20 border-emerald-500 text-emerald-200"
                          : "bg-yellow-600/20 border-yellow-500 text-yellow-200"
                        : "bg-gray-800/50 border-gray-700 text-gray-300 hover:bg-gray-700/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{store}</span>
                      {expected && (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 bg-emerald-700/40 border border-emerald-600/50 rounded text-emerald-300 font-medium">
                          Expected
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mismatch warning (soft — doesn't block) */}
          {selectedSender && selectedSender !== orderDetails.store_name && (
            <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-600/50 rounded-xl">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-300 mb-1">
                    Mismatch detected
                  </p>
                  <p className="text-yellow-200/80">
                    Shopify says <strong>{orderDetails.store_name}</strong> pero pinili mo{" "}
                    <strong>{selectedSender}</strong>. Pwede pa ring ituloy — pero
                    ma-noni-notify ang admin.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setPhase("scan_items")}
              disabled={fulfilling}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              ← Back
            </button>
            <button
              onClick={handleVerifyComplete}
              disabled={!selectedSender || fulfilling}
              className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              {fulfilling ? "Saving..." : "Confirm Packed ✓"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase 4: Verified ─── */}
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
