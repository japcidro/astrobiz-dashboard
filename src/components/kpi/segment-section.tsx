"use client";

import { useMemo } from "react";
import { KpiTile } from "./kpi-tile";
import type { KpiTileData } from "@/lib/kpi/types";

interface SegmentSectionProps {
  title: string;
  description?: string;
  tiles: KpiTileData[];
  onTileClick?: (tile: KpiTileData) => void;
}

export function SegmentSection({ title, description, tiles, onTileClick }: SegmentSectionProps) {
  const grouped = useMemo(() => {
    const individual = tiles.filter((t) => t.scope === "individual");
    const team = tiles.filter((t) => t.scope === "team" || t.scope === "watch");

    // Group individual tiles by employee for cleaner layout
    const byEmployee = new Map<string, KpiTileData[]>();
    for (const t of individual) {
      const key = t.employee_id ?? "unassigned";
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key)!.push(t);
    }

    return { byEmployee, team };
  }, [tiles]);

  if (tiles.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>

      {grouped.byEmployee.size > 0 && (
        <div className="space-y-3 mb-3">
          {Array.from(grouped.byEmployee.entries()).map(([empId, empTiles]) => {
            const name = empTiles[0]?.employee_name ?? "Unassigned";
            return (
              <div key={empId} className="bg-gray-900/40 rounded-lg p-3 border border-gray-800">
                <p className="text-xs font-medium text-gray-300 mb-2">{name}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {empTiles.map((tile) => (
                    <KpiTile
                      key={`${tile.kpi_key}|${tile.employee_id}`}
                      tile={tile}
                      onClick={onTileClick ? () => onTileClick(tile) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {grouped.team.length > 0 && (
        <div className="bg-gray-900/40 rounded-lg p-3 border border-gray-800">
          <p className="text-xs font-medium text-gray-300 mb-2">Team</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {grouped.team.map((tile) => (
              <KpiTile
                key={`${tile.kpi_key}|team`}
                tile={tile}
                onClick={onTileClick ? () => onTileClick(tile) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
