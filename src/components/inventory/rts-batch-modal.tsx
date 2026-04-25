"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { X, PackagePlus, ChevronRight, Loader2, Check } from "lucide-react";
import { BarcodeScannerInput } from "@/components/fulfillment/barcode-scanner-input";
import { ScanFeedback } from "@/components/fulfillment/scan-feedback";
import { playSuccess, playError } from "@/lib/fulfillment/audio";

interface ScanRow {
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  inventory_item_id: number;
  stock: number;
  store_name: string;
  store_id: string;
}

interface Location {
  id: number;
  name: string;
  store_name: string;
  active: boolean;
}

interface SessionEntry {
  sku: string;
  product_title: string;
  variant_title: string | null;
  newStock: number;
  at: number;
}

type Step = "open" | "scanning" | "summary";

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

export function RtsBatchModal({ open, onClose, onCompleted }: Props) {
  const [step, setStep] = useState<Step>("open");

  // Reference data
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<ScanRow[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [refsError, setRefsError] = useState<string | null>(null);

  // Step "open" form
  const [batchRef, setBatchRef] = useState("");
  const [storeId, setStoreId] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Step "scanning"
  const [batch, setBatch] = useState<{
    id: string;
    batch_ref: string;
    store_id: string;
    store_name: string;
  } | null>(null);
  const [sessionLog, setSessionLog] = useState<SessionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | null;
    message: string;
    subMessage?: string;
  }>({ type: null, message: "" });

  // Step "summary"
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // ── Load reference data when modal opens ──
  const loadRefs = useCallback(async () => {
    setLoadingRefs(true);
    setRefsError(null);
    try {
      const [invRes, locRes] = await Promise.all([
        fetch("/api/shopify/inventory?store=ALL"),
        fetch("/api/shopify/fulfillment/locations"),
      ]);
      const invJson = await invRes.json();
      const locJson = await locRes.json();
      if (!invRes.ok) throw new Error(invJson.error || "Failed to load inventory");

      const rows: ScanRow[] = (invJson.rows || []).map(
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
    } catch (e) {
      setRefsError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingRefs(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Reset state every open
    setStep("open");
    setBatchRef("");
    setStoreId("");
    setNotes("");
    setCreateError(null);
    setBatch(null);
    setSessionLog([]);
    setCloseError(null);
    loadRefs();
  }, [open, loadRefs]);

  // ── Scan helpers ──
  const findByScan = useCallback(
    (value: string): ScanRow | null => {
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
    },
    [inventory, batch]
  );

  const getLocationForStore = useCallback(
    (storeName: string): Location | null => {
      const match = locations.find(
        (l) => l.store_name === storeName && l.active
      );
      return match || (locations.length > 0 ? locations[0] : null);
    },
    [locations]
  );

  const sessionTotals = useMemo(() => {
    const map = new Map<string, { sku: string; title: string; count: number }>();
    for (const e of sessionLog) {
      const key = e.sku;
      const existing = map.get(key);
      const title = `${e.product_title}${e.variant_title ? ` / ${e.variant_title}` : ""}`;
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { sku: key, title, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [sessionLog]);

  // ── Open batch ──
  async function handleOpenBatch() {
    if (creating) return;
    const ref = batchRef.trim();
    if (!ref) {
      setCreateError("Batch reference is required");
      return;
    }
    if (!storeId) {
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
          store_id: storeId,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to open batch");

      setBatch({
        id: json.batch.id,
        batch_ref: json.batch.batch_ref,
        store_id: json.batch.store_id,
        store_name: json.batch.store_name,
      });
      setStep("scanning");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to open batch");
    } finally {
      setCreating(false);
    }
  }

  // ── Scan handler ──
  async function handleScan(value: string) {
    if (!batch || scanning) return;

    const product = findByScan(value);
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

      // Bump local inventory cache so subsequent scans show the new stock
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
  }

  // ── Close batch ──
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
              <p className="text-xs text-gray-400">
                {step === "open" && "Open a new RTS batch"}
                {step === "scanning" &&
                  batch &&
                  `Batch ${batch.batch_ref} · ${batch.store_name}`}
                {step === "summary" && "Batch closed"}
              </p>
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
          {/* STEP: open ── */}
          {step === "open" && (
            <div className="space-y-4">
              {loadingRefs ? (
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
                      value={storeId}
                      onChange={(e) => setStoreId(e.target.value)}
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
                      Batch reference (J&amp;T waybill or label)
                    </label>
                    <input
                      type="text"
                      value={batchRef}
                      onChange={(e) => setBatchRef(e.target.value)}
                      placeholder="e.g. JT-1234567 or RTS 2026-04-25 AM"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="e.g. Mostly damaged, 3 missing items"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none resize-none"
                    />
                  </div>

                  {createError && (
                    <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
                      {createError}
                    </div>
                  )}

                  <button
                    onClick={handleOpenBatch}
                    disabled={creating || !batchRef.trim() || !storeId}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {creating ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <ChevronRight size={18} />
                    )}
                    Open Batch &amp; Start Scanning
                  </button>
                </>
              )}
            </div>
          )}

          {/* STEP: scanning ── */}
          {step === "scanning" && batch && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
                <div className="text-sm">
                  <p className="text-gray-400">Scanned this batch</p>
                  <p className="text-2xl font-bold text-white">
                    {sessionLog.length}{" "}
                    <span className="text-sm text-gray-400 font-normal">
                      unit{sessionLog.length === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
                <div className="text-sm text-right">
                  <p className="text-gray-400">Unique SKUs</p>
                  <p className="text-2xl font-bold text-white">
                    {sessionTotals.length}
                  </p>
                </div>
              </div>

              <BarcodeScannerInput
                onScan={handleScan}
                placeholder={`Scan returned item (${batch.store_name})`}
                disabled={scanning}
                autoFocus
              />

              {sessionLog.length > 0 ? (
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-2">
                    Session
                  </p>
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
              ) : (
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
                className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                {closing ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <Check size={18} />
                )}
                Close Batch ({sessionLog.length} unit
                {sessionLog.length === 1 ? "" : "s"})
              </button>
            </div>
          )}

          {/* STEP: summary ── */}
          {step === "summary" && batch && (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-400 mb-1">
                  <Check size={18} />
                  <p className="font-semibold">Batch closed</p>
                </div>
                <p className="text-sm text-gray-300">
                  {sessionLog.length} unit{sessionLog.length === 1 ? "" : "s"}{" "}
                  across {sessionTotals.length} SKU
                  {sessionTotals.length === 1 ? "" : "s"} returned to stock for{" "}
                  {batch.store_name}.
                </p>
              </div>

              {sessionTotals.length > 0 && (
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-2">
                    Per-SKU totals
                  </p>
                  <div className="space-y-1">
                    {sessionTotals.map((t) => (
                      <div
                        key={t.sku}
                        className="flex items-center justify-between bg-gray-800/30 border border-gray-700/30 rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1 truncate">
                          <span className="text-white font-mono mr-2">
                            {t.sku}
                          </span>
                          <span className="text-gray-500 truncate">
                            {t.title}
                          </span>
                        </div>
                        <span className="text-emerald-400 font-bold ml-2">
                          +{t.count}
                        </span>
                      </div>
                    ))}
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
