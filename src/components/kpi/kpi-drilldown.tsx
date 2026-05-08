"use client";

import { X } from "lucide-react";
import { formatKpiValue, statusColors } from "@/lib/kpi/status";
import type { KpiTileData } from "@/lib/kpi/types";

interface KpiDrilldownProps {
  tile: KpiTileData | null;
  onClose: () => void;
}

export function KpiDrilldown({ tile, onClose }: KpiDrilldownProps) {
  if (!tile) return null;
  const colors = statusColors(tile.status);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-gray-950 border-l border-gray-800 z-50 overflow-y-auto">
        <div className="sticky top-0 bg-gray-950 border-b border-gray-800 p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              {tile.employee_name ?? (tile.scope === "watch" ? "CEO watch" : "Team")}
            </p>
            <h3 className="text-base font-semibold text-white">{tile.display_name}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className={`rounded-lg border p-4 ${colors.bg} ${colors.border}`}>
            <div className="flex items-baseline gap-3">
              <span className={`text-3xl font-bold ${colors.text}`}>
                {formatKpiValue(tile.value, tile.unit)}
              </span>
              <span className={`w-3 h-3 rounded-full ${colors.dot}`} />
              <span className={`text-xs uppercase ${colors.text}`}>
                {tile.status ?? "no data"}
              </span>
            </div>
            {tile.snapshot_date && (
              <p className="text-[10px] text-gray-500 mt-2">
                As of {tile.snapshot_date}
              </p>
            )}
          </div>

          <div className="bg-gray-900/40 rounded-lg p-3 border border-gray-800 text-xs text-gray-300 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500">Direction</span>
              <span>{tile.direction === "higher_better" ? "Higher is better" : "Lower is better"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Green threshold</span>
              <span>
                {tile.direction === "higher_better" ? "≥" : "≤"}
                {formatKpiValue(tile.green_threshold, tile.unit)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Red threshold</span>
              <span>
                {tile.direction === "higher_better" ? "<" : ">"}
                {formatKpiValue(tile.red_threshold, tile.unit)}
              </span>
            </div>
          </div>

          {tile.raw_data && Object.keys(tile.raw_data).length > 0 && (
            <div className="bg-gray-900/40 rounded-lg p-3 border border-gray-800">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
                Breakdown
              </p>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                {JSON.stringify(tile.raw_data, null, 2)}
              </pre>
            </div>
          )}

          {!tile.raw_data && (
            <p className="text-xs text-gray-500 italic">
              Drill-down breakdown will appear here once the cron has computed snapshots for
              this KPI.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
