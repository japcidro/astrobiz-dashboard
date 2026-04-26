"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  X,
  PackagePlus,
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
  Search,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";
import { playSuccess, playError } from "@/lib/fulfillment/audio";

// ── Types ────────────────────────────────────────────────────────────────────

interface Location {
  id: number;
  name: string;
  store_name: string;
  active: boolean;
}

interface ResolvedItem {
  shopify_line_item_id: string;
  sku: string | null;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  inventory_item_id: number | null;
  expected_qty: number;
}

interface ResolvedPayload {
  waybill: string;
  lookup_source: "jt_deliveries" | "shopify_tracking_map";
  store: { id: string; name: string };
  order: {
    shopify_order_id: string;
    shopify_order_name: string;
    shopify_order_date: string | null;
    shopify_customer_email: string | null;
    receiver: string | null;
    cod_amount: number | null;
  };
  expected_items: ResolvedItem[];
  existing_batch: {
    id: string;
    status: "open" | "closed";
    opened_at: string;
    closed_at: string | null;
    opened_by: string;
    opened_by_name: string | null;
  } | null;
}

interface BatchItem {
  id: string;
  shopify_line_item_id: string | null;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  variant_title: string | null;
  inventory_item_id: number | null;
  expected_qty: number;
  received_qty: number;
  damaged_qty: number;
  notes: string | null;
}

interface ActiveBatch {
  id: string;
  batch_ref: string;
  waybill: string | null;
  store_id: string;
  store_name: string;
  shopify_order_name: string | null;
  // Free-scan inventory snapshot for manual-fallback batches.
  isManual: boolean;
}

// Free-scan row used by manual-fallback flow only. The waybill flow doesn't
// need this — it scans against the seeded items list.
interface InventoryRow {
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  inventory_item_id: number;
  stock: number;
  store_name: string;
  store_id: string;
}

type Step =
  | "waybill_scan"
  | "resolving"
  | "not_found"
  | "confirm_prefill"
  | "closed_blocked"
  | "manual_fallback"
  | "scanning"
  | "summary";

interface SessionEntry {
  sku: string;
  product_title: string;
  variant_title: string | null;
  newStock: number;
  at: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RtsBatchModal({ open, onClose, onCompleted }: Props) {
  const [step, setStep] = useState<Step>("waybill_scan");

  // Waybill resolver state
  const [resolved, setResolved] = useState<ResolvedPayload | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [closedBatchInfo, setClosedBatchInfo] = useState<{
    closed_at: string | null;
    opened_by_name: string | null;
  } | null>(null);

  // Active batch (open or just-created)
  const [batch, setBatch] = useState<ActiveBatch | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);

  // Reference data — only used in manual-fallback flow
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [refsError, setRefsError] = useState<string | null>(null);

  // Manual fallback form
  const [manualBatchRef, setManualBatchRef] = useState("");
  const [manualStoreId, setManualStoreId] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Session log used for summary card on close
  const [sessionLog, setSessionLog] = useState<SessionEntry[]>([]);
  const [scanning, setScanning] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSummary, setCloseSummary] = useState<{
    item_count: number;
    unit_count: number;
    damaged_count: number;
    missing_count: number;
  } | null>(null);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setStep("waybill_scan");
    setResolved(null);
    setResolveError(null);
    setClosedBatchInfo(null);
    setBatch(null);
    setItems([]);
    setManualBatchRef("");
    setManualStoreId("");
    setManualNotes("");
    setCreateError(null);
    setSessionLog([]);
    setCloseError(null);
    setCloseSummary(null);
  }, [open]);

  // ── Lazy-load reference data only when manual fallback is needed. The
  //    waybill flow doesn't need the full inventory snapshot.
  const loadRefs = useCallback(async () => {
    if (refsLoaded) return;
    try {
      const [invRes, locRes] = await Promise.all([
        fetch("/api/shopify/inventory?store=ALL"),
        fetch("/api/shopify/fulfillment/locations"),
      ]);
      const invJson = await invRes.json();
      const locJson = await locRes.json();
      if (!invRes.ok) throw new Error(invJson.error || "Failed to load inventory");
      const rows: InventoryRow[] = (invJson.rows || []).map(
        (r: Record<string, unknown>) => ({
          sku: (r.sku as string) || "",
          barcode: (r.barcode as string) || null,
          product_title: (r.product_title as string) || "",
          variant_title: (r.variant_title as string) || null,
          inventory_item_id: (r.inventory_item_id as number) || 0,
          stock: (r.stock as number) ?? (r.available as number) ?? 0,
          store_name: (r.store_name as string) || "",
          store_id: (r.store_id as string) || "",
        })
      );
      setInventory(rows);
      if (invJson.stores) setStores(invJson.stores);
      if (locRes.ok) setLocations(locJson.locations || []);
      setRefsLoaded(true);
    } catch (e) {
      setRefsError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [refsLoaded]);

  // ── Waybill resolver flow ──
  async function handleWaybillScan(value: string) {
    const waybill = value.trim().toUpperCase();
    if (!waybill) return;
    setStep("resolving");
    setResolveError(null);
    try {
      const res = await fetch(
        `/api/inventory/rts-batches/resolve-waybill?waybill=${encodeURIComponent(waybill)}`
      );
      const json = await res.json();
      if (res.status === 404) {
        // Waybill not in jt_deliveries OR Shopify tracking map. Offer manual fallback.
        if (json.existing_batch?.status === "closed") {
          setClosedBatchInfo({
            closed_at: json.existing_batch.closed_at,
            opened_by_name: json.existing_batch.opened_by_name,
          });
          setStep("closed_blocked");
          return;
        }
        setResolveError(`Waybill ${waybill} not found in J&T or Shopify orders.`);
        // Pre-fill the manual form so VA doesn't retype the waybill.
        setManualBatchRef(waybill);
        setStep("not_found");
        return;
      }
      if (!res.ok) throw new Error(json.error || "Resolver failed");

      const payload = json as ResolvedPayload;
      setResolved(payload);

      // Existing-batch handling
      if (payload.existing_batch) {
        if (payload.existing_batch.status === "closed") {
          setClosedBatchInfo({
            closed_at: payload.existing_batch.closed_at,
            opened_by_name: payload.existing_batch.opened_by_name,
          });
          setStep("closed_blocked");
          return;
        }
        // Open batch — resume directly. Hand-off allowed.
        await resumeBatch(payload.existing_batch.id, payload);
        return;
      }

      setStep("confirm_prefill");
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Resolver failed");
      setStep("waybill_scan");
    }
  }

  async function resumeBatch(batchId: string, payload: ResolvedPayload | null) {
    try {
      const res = await fetch(`/api/inventory/rts-batches/${batchId}/items`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load batch");

      setBatch({
        id: batchId,
        batch_ref: json.batch.waybill || json.batch.batch_ref || "",
        waybill: json.batch.waybill,
        store_id: json.batch.store_id,
        store_name: payload?.store.name ?? "",
        shopify_order_name: json.batch.shopify_order_name ?? null,
        isManual: false,
      });
      setItems(json.items as BatchItem[]);
      // Waybill flow: scan endpoint resolves location_id server-side, so we
      // don't preload /locations here.
      setStep("scanning");
    } catch (e) {
      setResolveError(
        e instanceof Error ? e.message : "Failed to resume batch"
      );
      setStep("waybill_scan");
    }
  }

  async function handleConfirmPrefill() {
    if (!resolved || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/inventory/rts-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waybill: resolved.waybill,
          store_id: resolved.store.id,
          shopify_order_id: resolved.order.shopify_order_id,
          shopify_order_name: resolved.order.shopify_order_name,
          shopify_order_date: resolved.order.shopify_order_date,
          lookup_source: resolved.lookup_source,
          expected_items: resolved.expected_items.map((it) => ({
            shopify_line_item_id: it.shopify_line_item_id,
            sku: it.sku,
            barcode: it.barcode,
            product_title: it.product_title,
            variant_title: it.variant_title,
            inventory_item_id: it.inventory_item_id,
            expected_qty: it.expected_qty,
          })),
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.existing_batch?.status === "open") {
        // Race: someone opened it between resolve and create. Resume.
        await resumeBatch(json.existing_batch.id, resolved);
        return;
      }
      if (!res.ok) throw new Error(json.error || "Failed to create batch");

      const itemsRes = await fetch(
        `/api/inventory/rts-batches/${json.batch.id}/items`
      );
      const itemsJson = await itemsRes.json();

      setBatch({
        id: json.batch.id,
        batch_ref: json.batch.waybill || json.batch.batch_ref,
        waybill: json.batch.waybill,
        store_id: json.batch.store_id,
        store_name: resolved.store.name,
        shopify_order_name: resolved.order.shopify_order_name,
        isManual: false,
      });
      setItems((itemsJson.items as BatchItem[]) ?? []);
      // Waybill flow: scan endpoint resolves location_id server-side.
      setStep("scanning");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to open batch");
    } finally {
      setCreating(false);
    }
  }

  // ── Manual fallback flow (preserved from old modal) ──
  async function handleEnterManual() {
    setStep("manual_fallback");
    await loadRefs();
  }

  async function handleManualOpenBatch() {
    if (creating) return;
    const ref = manualBatchRef.trim();
    if (!ref) {
      setCreateError("Batch reference is required");
      return;
    }
    if (!manualStoreId) {
      setCreateError("Pick a store");
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/inventory/rts-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_ref: ref,
          store_id: manualStoreId,
          notes: manualNotes.trim() || undefined,
          lookup_source: "manual_fallback",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to open batch");

      const storeName =
        stores.find((s) => s.id === manualStoreId)?.name ?? "";
      setBatch({
        id: json.batch.id,
        batch_ref: json.batch.batch_ref,
        waybill: json.batch.waybill,
        store_id: json.batch.store_id,
        store_name: storeName,
        shopify_order_name: null,
        isManual: true,
      });
      setItems([]);
      setStep("scanning");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to open batch");
    } finally {
      setCreating(false);
    }
  }

  // ── Scan handlers ──
  const getLocationForStore = useCallback(
    (storeName: string): Location | null => {
      const match = locations.find(
        (l) => l.store_name === storeName && l.active
      );
      return match || (locations.length > 0 ? locations[0] : null);
    },
    [locations]
  );

  function findItemByScan(value: string): BatchItem | null {
    const trimmed = value.trim().toLowerCase();
    return (
      items.find(
        (it) =>
          (it.sku && it.sku.toLowerCase() === trimmed) ||
          (it.barcode && it.barcode.toLowerCase() === trimmed)
      ) || null
    );
  }

  function findInventoryByScan(value: string): InventoryRow | null {
    if (!batch) return null;
    const trimmed = value.trim().toLowerCase();
    return (
      inventory.find(
        (r) =>
          r.store_id === batch.store_id &&
          (r.sku?.toLowerCase() === trimmed ||
            r.barcode?.toLowerCase() === trimmed)
      ) || null
    );
  }

  async function handleScanItem(value: string) {
    if (!batch || scanning) return;

    if (batch.isManual) {
      // Free-scan flow — same as old modal.
      const product = findInventoryByScan(value);
      if (!product) {
        playError();
        setFeedback({
          type: "error",
          message: "NOT FOUND",
          subMessage: `${value.trim()} (not in ${batch.store_name})`,
        });
        return;
      }
      const loc = getLocationForStore(product.store_name);
      if (!loc) {
        playError();
        setFeedback({
          type: "error",
          message: "NO LOCATION",
          subMessage: "No fulfillment location for this store",
        });
        return;
      }
      setScanning(true);
      try {
        const res = await fetch("/api/shopify/inventory-adjust", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_name: product.store_name,
            location_id: String(loc.id),
            inventory_item_id: product.inventory_item_id,
            mode: "adjust",
            quantity: 1,
            sku: product.sku,
            product_title: product.product_title,
            rts_batch_id: batch.id,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Adjust failed");
        const newStock = json.new_qty ?? product.stock + 1;
        setInventory((prev) =>
          prev.map((r) =>
            r.inventory_item_id === product.inventory_item_id
              ? { ...r, stock: newStock }
              : r
          )
        );
        setSessionLog((prev) => [
          {
            sku: product.sku,
            product_title: product.product_title,
            variant_title: product.variant_title,
            newStock,
            at: Date.now(),
          },
          ...prev,
        ]);
        playSuccess();
        setFeedback({
          type: "success",
          message: `+1 ${product.sku}`,
          subMessage: `now ${newStock}`,
        });
      } catch (e) {
        playError();
        setFeedback({
          type: "error",
          message: "ADJUST FAILED",
          subMessage: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setScanning(false);
      }
      return;
    }

    // Waybill flow — match scan against seeded items.
    const item = findItemByScan(value);
    if (!item) {
      playError();
      setFeedback({
        type: "error",
        message: "NOT ON ORDER",
        subMessage: `${value.trim()} isn't expected in this parcel`,
      });
      return;
    }
    setScanning(true);
    try {
      const res = await fetch(
        `/api/inventory/rts-batches/${batch.id}/items/${item.id}/scan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Server resolves location_id from the batch's store. No client-side
          // lookup needed — that path was timing-fragile and surfaced as a
          // misleading "NO LOCATION" error.
          body: JSON.stringify({}),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed");

      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, received_qty: json.received_qty } : it
        )
      );
      setSessionLog((prev) => [
        {
          sku: item.sku ?? "(no sku)",
          product_title: item.product_title ?? "",
          variant_title: item.variant_title,
          newStock: json.new_qty ?? 0,
          at: Date.now(),
        },
        ...prev,
      ]);

      if (json.over_scan) {
        playError();
        setFeedback({
          type: "warning",
          message: `EXTRA: ${item.sku}`,
          subMessage: `Already at expected ${item.expected_qty} — counted as extra`,
        });
      } else {
        playSuccess();
        setFeedback({
          type: "success",
          message: `+1 ${item.sku}`,
          subMessage: `${json.received_qty}/${item.expected_qty}`,
        });
      }
    } catch (e) {
      playError();
      setFeedback({
        type: "error",
        message: "SCAN FAILED",
        subMessage: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setScanning(false);
    }
  }

  async function adjustDamaged(itemId: string, delta: number) {
    const item = items.find((it) => it.id === itemId);
    if (!item || !batch) return;
    const next = Math.max(item.damaged_qty + delta, 0);
    if (next === item.damaged_qty) return;
    // Optimistic update.
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, damaged_qty: next } : it
      )
    );
    try {
      const res = await fetch(
        `/api/inventory/rts-batches/${batch.id}/items/${itemId}/mark`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ damaged_qty: next }),
        }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Mark failed");
      }
    } catch {
      // Revert on failure.
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId ? { ...it, damaged_qty: item.damaged_qty } : it
        )
      );
      playError();
      setFeedback({
        type: "error",
        message: "MARK FAILED",
        subMessage: "Couldn't update damaged count",
      });
    }
  }

  // ── Close ──
  async function handleCloseBatch() {
    if (!batch || closing) return;
    setCloseError(null);
    setClosing(true);
    try {
      const res = await fetch(
        `/api/inventory/rts-batches/${batch.id}/close`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to close batch");
      setCloseSummary({
        item_count: json.item_count,
        unit_count: json.unit_count,
        damaged_count: json.damaged_count ?? 0,
        missing_count: json.missing_count ?? 0,
      });
      setStep("summary");
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : "Failed to close batch");
    } finally {
      setClosing(false);
    }
  }

  function handleFinish() {
    onCompleted?.();
    onClose();
  }

  // ── Derived values for rendering ──
  const totals = useMemo(() => {
    let received = 0;
    let damaged = 0;
    let expected = 0;
    for (const it of items) {
      received += it.received_qty;
      damaged += it.damaged_qty;
      expected += it.expected_qty;
    }
    const missing = Math.max(expected - received - damaged, 0);
    return { received, damaged, expected, missing };
  }, [items]);

  const headerSubtitle = (() => {
    switch (step) {
      case "waybill_scan":
        return "Scan the J&T waybill to start";
      case "resolving":
        return "Looking up the order…";
      case "not_found":
        return "Waybill not found";
      case "confirm_prefill":
        return "Confirm the order";
      case "closed_blocked":
        return "Already processed";
      case "manual_fallback":
        return "Open a manual batch";
      case "scanning":
        return batch
          ? `${batch.shopify_order_name ?? batch.batch_ref} · ${batch.store_name}`
          : "Scanning";
      case "summary":
        return "Batch closed";
    }
  })();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="bg-gray-900 border border-gray-700 sm:rounded-2xl w-full sm:max-w-2xl max-h-screen overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <PackagePlus size={20} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">RTS Return</h2>
              <p className="text-xs text-gray-400">{headerSubtitle}</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (step === "scanning" && sessionLog.length > 0) {
                if (
                  !confirm(
                    "Close this batch first or you'll leave it open. Leave anyway?"
                  )
                ) {
                  return;
                }
              }
              onClose();
            }}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1">
          {/* STEP: waybill_scan ─────────────────────────────────────── */}
          {step === "waybill_scan" && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-800/30 border border-gray-700/50 rounded-xl">
                <p className="text-sm text-gray-300 mb-3">
                  Scan the J&amp;T waybill barcode on the parcel.
                </p>
                <BarcodeScannerInput
                  onScan={handleWaybillScan}
                  placeholder="Scan waybill (e.g. JT0016580144458)"
                  autoFocus
                />
              </div>

              {resolveError && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                  {resolveError}
                </div>
              )}

              <button
                onClick={handleEnterManual}
                className="w-full text-sm text-gray-400 hover:text-white py-2 underline-offset-2 hover:underline cursor-pointer"
              >
                Walang waybill? Open manual batch instead
              </button>
            </div>
          )}

          {/* STEP: resolving ────────────────────────────────────────── */}
          {step === "resolving" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-300">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <Search size={20} className="text-emerald-400 animate-pulse" />
              </div>
              <p className="text-sm">Looking up the order…</p>
              <p className="text-xs text-gray-500">
                Checking J&amp;T deliveries and Shopify fulfillments
              </p>
            </div>
          )}

          {/* STEP: not_found ───────────────────────────────────────── */}
          {step === "not_found" && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex gap-3">
                <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-semibold mb-1">Waybill not found</p>
                  <p className="text-amber-200/80">
                    Hindi pa ma-resolve sa J&amp;T or Shopify. Pwede mong i-try
                    ulit later (kapag nag-sync na yung J&amp;T) or open a
                    manual batch ngayon na.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setResolveError(null);
                    setStep("waybill_scan");
                  }}
                  className="flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg cursor-pointer"
                >
                  <ArrowLeft size={16} /> Try again
                </button>
                <button
                  onClick={handleEnterManual}
                  className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg cursor-pointer"
                >
                  <Pencil size={16} /> Enter manually
                </button>
              </div>
            </div>
          )}

          {/* STEP: closed_blocked ──────────────────────────────────── */}
          {step === "closed_blocked" && closedBatchInfo && (
            <div className="space-y-4">
              <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl flex gap-3">
                <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-200">
                  <p className="font-semibold mb-1">Already processed</p>
                  <p className="text-red-200/80">
                    Na-process na ito{" "}
                    {closedBatchInfo.opened_by_name
                      ? `ni ${closedBatchInfo.opened_by_name}`
                      : ""}
                    {closedBatchInfo.closed_at
                      ? ` noong ${new Date(closedBatchInfo.closed_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`
                      : ""}
                    . Tawagin si admin kung may correction na kailangan.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setClosedBatchInfo(null);
                  setStep("waybill_scan");
                }}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg cursor-pointer"
              >
                Back
              </button>
            </div>
          )}

          {/* STEP: confirm_prefill ─────────────────────────────────── */}
          {step === "confirm_prefill" && resolved && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-800/40 border border-gray-700/50 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase text-gray-500">Store</span>
                  <span className="text-sm font-semibold text-white">
                    {resolved.store.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase text-gray-500">Order</span>
                  <span className="text-sm font-semibold text-white">
                    {resolved.order.shopify_order_name}
                  </span>
                </div>
                {resolved.order.shopify_order_date && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-gray-500">Date</span>
                    <span className="text-sm text-gray-300">
                      {resolved.order.shopify_order_date}
                    </span>
                  </div>
                )}
                {resolved.order.receiver && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-gray-500">
                      Receiver
                    </span>
                    <span className="text-sm text-gray-300">
                      {resolved.order.receiver}
                    </span>
                  </div>
                )}
                {resolved.order.cod_amount !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-gray-500">COD</span>
                    <span className="text-sm text-gray-300">
                      ₱{resolved.order.cod_amount.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs uppercase text-gray-500 mb-2">
                  Expected items ({resolved.expected_items.length})
                </p>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {resolved.expected_items.map((it) => (
                    <div
                      key={it.shopify_line_item_id}
                      className="flex items-center justify-between bg-gray-800/30 border border-gray-700/30 rounded-lg px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <span className="text-white font-mono mr-2">
                          {it.sku ?? "(no sku)"}
                        </span>
                        <span className="text-gray-500 truncate">
                          {it.product_title}
                          {it.variant_title ? ` / ${it.variant_title}` : ""}
                        </span>
                      </div>
                      <span className="text-gray-400 ml-2 whitespace-nowrap">
                        × {it.expected_qty}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {createError && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setResolved(null);
                    setStep("waybill_scan");
                  }}
                  className="flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg cursor-pointer"
                >
                  <ArrowLeft size={16} /> Wrong package
                </button>
                <button
                  onClick={handleConfirmPrefill}
                  disabled={creating}
                  className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {creating ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  Start scanning
                </button>
              </div>
            </div>
          )}

          {/* STEP: manual_fallback ─────────────────────────────────── */}
          {step === "manual_fallback" && (
            <div className="space-y-4">
              {!refsLoaded && !refsError ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="animate-spin mr-2" size={18} />
                  Loading stores…
                </div>
              ) : refsError ? (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                  {refsError}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">
                      Store
                    </label>
                    <select
                      value={manualStoreId}
                      onChange={(e) => setManualStoreId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">— Select store —</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-1">
                      Batch reference (waybill or label)
                    </label>
                    <input
                      type="text"
                      value={manualBatchRef}
                      onChange={(e) => setManualBatchRef(e.target.value)}
                      placeholder="e.g. JT-1234567 or RTS 2026-04-25 AM"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      rows={2}
                      placeholder="e.g. Lost label, manual count"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none resize-none"
                    />
                  </div>

                  {createError && (
                    <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                      {createError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setStep("waybill_scan")}
                      className="flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg cursor-pointer"
                    >
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button
                      onClick={handleManualOpenBatch}
                      disabled={creating || !manualBatchRef.trim() || !manualStoreId}
                      className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg disabled:opacity-50 cursor-pointer"
                    >
                      {creating ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      Open
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP: scanning ─────────────────────────────────────────── */}
          {step === "scanning" && batch && (
            <div className="space-y-4">
              {/* Scoreboard */}
              {!batch.isManual ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Received</p>
                    <p className="text-2xl font-bold text-emerald-400">
                      {totals.received}
                      <span className="text-sm text-gray-400 font-normal">
                        /{totals.expected}
                      </span>
                    </p>
                  </div>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Damaged</p>
                    <p className="text-2xl font-bold text-amber-400">
                      {totals.damaged}
                    </p>
                  </div>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Missing</p>
                    <p className="text-2xl font-bold text-red-400">
                      {totals.missing}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
                  <p className="text-xs uppercase text-gray-500">Scanned</p>
                  <p className="text-2xl font-bold text-white">
                    {sessionLog.length}{" "}
                    <span className="text-sm text-gray-400 font-normal">
                      unit{sessionLog.length === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
              )}

              <BarcodeScannerInput
                onScan={handleScanItem}
                placeholder={
                  batch.isManual
                    ? `Scan returned item (${batch.store_name})`
                    : "Scan item barcode"
                }
                disabled={scanning}
                autoFocus
              />

              {/* Per-item checklist for waybill flow */}
              {!batch.isManual && items.length > 0 && (
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-2">
                    Items ({items.length})
                  </p>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {items.map((it) => {
                      const fullyAccounted =
                        it.received_qty + it.damaged_qty >= it.expected_qty;
                      return (
                        <div
                          key={it.id}
                          className={`border rounded-lg px-3 py-2 text-sm ${
                            fullyAccounted
                              ? "bg-emerald-500/5 border-emerald-700/30"
                              : "bg-gray-800/30 border-gray-700/30"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 truncate">
                              <span className="text-white font-mono mr-2">
                                {it.sku ?? "(no sku)"}
                              </span>
                              <span className="text-gray-500 truncate">
                                {it.product_title}
                                {it.variant_title ? ` / ${it.variant_title}` : ""}
                              </span>
                            </div>
                            <span
                              className={`whitespace-nowrap font-mono ${
                                fullyAccounted
                                  ? "text-emerald-400"
                                  : "text-gray-300"
                              }`}
                            >
                              {it.received_qty}/{it.expected_qty}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-2 text-xs">
                            <span className="text-gray-500">Damaged</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => adjustDamaged(it.id, -1)}
                                disabled={it.damaged_qty <= 0}
                                className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-30 cursor-pointer"
                              >
                                −
                              </button>
                              <span className="font-mono text-amber-300 w-6 text-center">
                                {it.damaged_qty}
                              </span>
                              <button
                                onClick={() => adjustDamaged(it.id, 1)}
                                className="w-7 h-7 rounded bg-amber-700 hover:bg-amber-600 text-white cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Free-scan session log for manual flow */}
              {batch.isManual && sessionLog.length > 0 && (
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-2">Session</p>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {sessionLog.slice(0, 50).map((e, i) => (
                      <div
                        key={`${e.sku}-${e.at}-${i}`}
                        className="flex items-center justify-between bg-gray-800/30 border border-gray-700/30 rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1 truncate">
                          <span className="text-emerald-400 font-mono mr-2">
                            +1
                          </span>
                          <span className="text-white font-mono">{e.sku}</span>
                          <span className="text-gray-500 ml-2 truncate">
                            {e.product_title}
                            {e.variant_title ? ` / ${e.variant_title}` : ""}
                          </span>
                        </div>
                        <span className="text-gray-400 ml-2 whitespace-nowrap">
                          → {e.newStock}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {batch.isManual && sessionLog.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Scan the first returned item to start the session log.
                </div>
              )}

              {closeError && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                  {closeError}
                </div>
              )}

              <button
                onClick={handleCloseBatch}
                disabled={closing}
                className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                {closing ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <Check size={18} />
                )}
                {batch.isManual
                  ? `Close Batch (${sessionLog.length} unit${sessionLog.length === 1 ? "" : "s"})`
                  : `Close Batch (${totals.received} received, ${totals.damaged} damaged, ${totals.missing} missing)`}
              </button>
            </div>
          )}

          {/* STEP: summary ──────────────────────────────────────────── */}
          {step === "summary" && batch && closeSummary && (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-400 mb-1">
                  <Check size={18} />
                  <p className="font-semibold">Batch closed</p>
                </div>
                <p className="text-sm text-gray-300">
                  {closeSummary.unit_count} unit
                  {closeSummary.unit_count === 1 ? "" : "s"} returned to stock
                  for {batch.store_name}.
                </p>
              </div>

              {!batch.isManual && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-500/5 border border-emerald-700/30 rounded-lg p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Received</p>
                    <p className="text-xl font-bold text-emerald-400">
                      {closeSummary.unit_count}
                    </p>
                  </div>
                  <div className="bg-amber-500/5 border border-amber-700/30 rounded-lg p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Damaged</p>
                    <p className="text-xl font-bold text-amber-400">
                      {closeSummary.damaged_count}
                    </p>
                  </div>
                  <div className="bg-red-500/5 border border-red-700/30 rounded-lg p-3 text-center">
                    <p className="text-xs uppercase text-gray-500">Missing</p>
                    <p className="text-xl font-bold text-red-400">
                      {closeSummary.missing_count}
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={handleFinish}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      <ScanFeedback
        type={feedback.type}
        message={feedback.message}
        subMessage={feedback.subMessage}
        onDismiss={() => setFeedback({ type: null, message: "" })}
      />
    </div>
  );
}
