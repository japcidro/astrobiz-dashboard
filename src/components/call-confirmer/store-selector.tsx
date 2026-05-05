"use client";

import type { ShopifyStoreLite } from "@/lib/call-confirmer/types";

interface Props {
  stores: ShopifyStoreLite[];
  value: string;
  onChange: (storeId: string) => void;
  label?: string;
  className?: string;
}

export function StoreSelector({
  stores,
  value,
  onChange,
  label = "Store",
  className = "",
}: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="text-sm text-gray-400">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
