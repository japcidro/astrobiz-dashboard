"use client";

import { formatKpiValue, statusColors } from "@/lib/kpi/status";
import type { KpiTileData } from "@/lib/kpi/types";

interface KpiTileProps {
  tile: KpiTileData;
  onClick?: () => void;
}

export function KpiTile({ tile, onClick }: KpiTileProps) {
  const colors = statusColors(tile.status);
  const subtitle = tile.employee_name ?? (tile.scope === "watch" ? "CEO watch" : "Team");
  const targetHint = formatTargetHint(tile);

  return (
    <button
      onClick={onClick}
      type="button"
      className={`text-left w-full rounded-lg border p-4 transition-colors ${colors.bg} ${colors.border} hover:border-gray-600 cursor-pointer`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          {subtitle}
        </span>
        <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
      </div>
      <p className="text-xs text-gray-400 mb-1.5 line-clamp-2 min-h-[2.25rem]">
        {tile.display_name}
      </p>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold ${colors.text}`}>
          {formatKpiValue(tile.value, tile.unit)}
        </span>
        {tile.value === null && (
          <span className="text-[10px] text-gray-600 uppercase">no data yet</span>
        )}
      </div>
      <p className="text-[10px] text-gray-500 mt-2">{targetHint}</p>
    </button>
  );
}

function formatTargetHint(tile: KpiTileData): string {
  const unit = tile.unit ?? "";
  const fmt = (n: number) => {
    if (unit === "%") return `${n}%`;
    if (unit === "x") return `${n}x`;
    if (unit === "hours") return `${n}h`;
    return `${n}`;
  };
  if (tile.direction === "higher_better") {
    return `🟢 ≥${fmt(tile.green_threshold)}  ·  🔴 <${fmt(tile.red_threshold)}`;
  }
  return `🟢 ≤${fmt(tile.green_threshold)}  ·  🔴 >${fmt(tile.red_threshold)}`;
}
