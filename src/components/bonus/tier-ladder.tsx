"use client";

import { CheckCircle2, Circle, Lock } from "lucide-react";
import type { BonusTier } from "@/lib/bonus/types";

interface Props {
  tiers: BonusTier[];
  average: number;
  currentTierId: string | null;
}

function peso(value: number): string {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

export function TierLadder({ tiers, average, currentTierId }: Props) {
  const active = tiers
    .filter((t) => t.is_active)
    .sort((a, b) => a.parcel_threshold - b.parcel_threshold);

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <h2 className="text-sm font-semibold text-white mb-1">Bonus tiers</h2>
      <p className="text-[11px] text-gray-500 mb-4">
        Bawat tao sa company gets the amount of the highest tier the cutoff
        average clears.
      </p>

      {active.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          Walang naka-set na tiers. An admin can add them with “Edit tiers”.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((tier) => {
            const hit = average >= tier.parcel_threshold;
            const isCurrent = tier.id === currentTierId;
            return (
              <li
                key={tier.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  isCurrent
                    ? "border-yellow-600/60 bg-yellow-950/30"
                    : hit
                      ? "border-gray-800 bg-gray-900/40"
                      : "border-gray-800/60 bg-transparent"
                }`}
              >
                <span className="shrink-0">
                  {isCurrent ? (
                    <CheckCircle2 size={18} className="text-yellow-400" />
                  ) : hit ? (
                    <Circle size={18} className="text-gray-600" />
                  ) : (
                    <Lock size={16} className="text-gray-700" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${
                      hit ? "text-white" : "text-gray-500"
                    }`}
                  >
                    {tier.label ?? `Tier ${tier.parcel_threshold}`}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {tier.parcel_threshold} parcels/day average
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold shrink-0 ${
                    isCurrent
                      ? "text-yellow-300"
                      : hit
                        ? "text-gray-300"
                        : "text-gray-600"
                  }`}
                >
                  {peso(tier.bonus_amount)}
                  <span className="text-[10px] font-normal text-gray-600">
                    {" "}
                    / person
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
