"use client";

import { useState } from "react";
import { Loader2, Save, Wand2, Store as StoreIcon } from "lucide-react";
import {
  useStoreDefaults,
  unwrapStoreDefaults,
  type StoreAdDefaults,
} from "@/lib/marketing/store-defaults";

interface Props {
  selectedStoreId: string | null;
  onStoreChange: (id: string | null, storeName: string | null) => void;
  // Called when user clicks "Apply store defaults". Wizard patches its state
  // from these values. Only called on explicit click — never automatic —
  // so the user's typed-in work can't be overwritten silently.
  onApply: (defaults: StoreAdDefaults, storeName: string) => void;
  // Snapshot of the wizard's current shared fields. Sent to the API on
  // "Save current as store default". Omit shopify_store_id — we fill it.
  buildSnapshot: () => Omit<Partial<StoreAdDefaults>, "shopify_store_id" | "id">;
}

export function StoreDefaultsSelector({
  selectedStoreId,
  onStoreChange,
  onApply,
  buildSnapshot,
}: Props) {
  const { stores, loading, error, getDefaultsFor, saveDefaults } =
    useStoreDefaults();
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? null;
  const selectedDefaults = getDefaultsFor(selectedStoreId);
  const hasDefaultsSaved =
    !!selectedStoreId &&
    !!unwrapStoreDefaults(selectedStore?.store_ad_defaults);

  const handleApply = () => {
    if (!selectedStoreId || !selectedDefaults || !selectedStore) return;
    onApply(selectedDefaults, selectedStore.name);
    setFlash("Store defaults applied.");
    setTimeout(() => setFlash(null), 2500);
  };

  const handleSave = async () => {
    if (!selectedStoreId) return;
    setSaving(true);
    setFlash(null);
    try {
      await saveDefaults({
        shopify_store_id: selectedStoreId,
        ...buildSnapshot(),
      });
      setFlash("Saved as this store's default.");
      setTimeout(() => setFlash(null), 2500);
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <StoreIcon size={16} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-white">Store</h3>
        <span className="text-[11px] text-gray-500">
          Picks pre-fill Page, pixel, URL, CTA, targeting. Doesn&apos;t
          overwrite anything until you click Apply.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedStoreId ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            const name = stores.find((s) => s.id === id)?.name ?? null;
            onStoreChange(id, name);
          }}
          disabled={loading}
          className="min-w-[220px] bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value="">{loading ? "Loading stores..." : "No store selected"}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleApply}
          disabled={!selectedStoreId || !hasDefaultsSaved}
          title={
            !selectedStoreId
              ? "Pick a store first"
              : !hasDefaultsSaved
                ? "No defaults saved yet for this store"
                : "Fill Page, pixel, URL, CTA, targeting from saved defaults"
          }
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600/80 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium transition-colors cursor-pointer"
        >
          <Wand2 size={13} />
          Apply store defaults
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={!selectedStoreId || saving}
          title={
            !selectedStoreId
              ? "Pick a store first"
              : "Save the current Page / pixel / URL / CTA / targeting as this store's default"
          }
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors cursor-pointer"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "Saving..." : "Save current as default"}
        </button>

        {flash && (
          <span className="text-xs text-emerald-400">{flash}</span>
        )}
        {error && !flash && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>

      {selectedStoreId && !hasDefaultsSaved && (
        <p className="mt-2 text-[11px] text-yellow-500/80">
          No defaults saved for this store yet. Fill the form below, then
          click &quot;Save current as default&quot; to lock it in.
        </p>
      )}
    </div>
  );
}
