"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { BonusTier } from "@/lib/bonus/types";

interface Props {
  tiers: BonusTier[];
  onSaved: () => void;
}

interface DraftTier {
  key: string;
  label: string;
  parcel_threshold: string;
  is_active: boolean;
}

function toDraft(tier: BonusTier): DraftTier {
  return {
    key: tier.id,
    label: tier.label ?? "",
    parcel_threshold: String(tier.parcel_threshold),
    is_active: tier.is_active,
  };
}

export function TierEditor({ tiers, onSaved }: Props) {
  const [drafts, setDrafts] = useState<DraftTier[]>(() => tiers.map(toDraft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<DraftTier>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d))
    );
  };

  const addRow = () => {
    setDrafts((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        label: `Tier ${prev.length + 1}`,
        parcel_threshold: "",
        is_active: true,
      },
    ]);
  };

  const removeRow = (key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  };

  const save = async () => {
    setError(null);

    const payload = drafts.map((d) => ({
      parcel_threshold: Number(d.parcel_threshold),
      label: d.label,
      is_active: d.is_active,
    }));

    for (const row of payload) {
      if (!Number.isFinite(row.parcel_threshold) || row.parcel_threshold <= 0) {
        setError("Every tier needs a parcel threshold greater than 0.");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/bonus/tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save tiers");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tiers");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <h2 className="text-sm font-semibold text-white mb-1">Edit bonus tiers</h2>
      <p className="text-[11px] text-gray-500 mb-4">
        Threshold is the average parcels/day for the cutoff period. Payout
        amounts are not set here yet — the tracker only shows which tiers the
        team has hit.
      </p>

      <div className="space-y-2">
        {drafts.map((d) => (
          <div key={d.key} className="flex flex-wrap items-center gap-2">
            <input
              value={d.label}
              onChange={(e) => update(d.key, { label: e.target.value })}
              placeholder="Label"
              className="flex-1 min-w-[110px] bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
            <div className="relative">
              <input
                value={d.parcel_threshold}
                onChange={(e) =>
                  update(d.key, { parcel_threshold: e.target.value })
                }
                inputMode="numeric"
                placeholder="70"
                className="w-28 bg-gray-900 border border-gray-800 rounded pl-2 pr-12 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-600">
                /day
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={d.is_active}
                onChange={(e) => update(d.key, { is_active: e.target.checked })}
                className="accent-yellow-500 cursor-pointer"
              />
              Active
            </label>
            <button
              onClick={() => removeRow(d.key)}
              className="text-gray-600 hover:text-red-400 p-1 cursor-pointer"
              aria-label="Remove tier"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded border border-gray-800 hover:border-gray-600 cursor-pointer"
        >
          <Plus size={12} />
          Add tier
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs text-black bg-yellow-500 hover:bg-yellow-400 px-3 py-1.5 rounded font-medium cursor-pointer disabled:opacity-60"
        >
          <Save size={12} />
          {saving ? "Saving…" : "Save tiers"}
        </button>
      </div>
    </section>
  );
}
