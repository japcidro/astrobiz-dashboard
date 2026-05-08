"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { SegmentSection } from "./segment-section";
import { KpiDrilldown } from "./kpi-drilldown";
import type { KpiTileData } from "@/lib/kpi/types";

interface KpiDashboardClientProps {
  tiles: KpiTileData[];
  asOf: string;
}

export function KpiDashboardClient({ tiles, asOf }: KpiDashboardClientProps) {
  const router = useRouter();
  const [activeTile, setActiveTile] = useState<KpiTileData | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  const handleRecompute = async () => {
    setRecomputing(true);
    await fetch("/api/kpi/recompute", { method: "POST" });
    setRecomputing(false);
    router.refresh();
  };

  const summary = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, none: 0 };
    for (const t of tiles) {
      if (!t.status) counts.none++;
      else counts[t.status]++;
    }
    return counts;
  }, [tiles]);

  const sections = useMemo(() => {
    return {
      watch: tiles.filter((t) => t.segment === "watch"),
      marketing: tiles.filter((t) => t.segment === "marketing"),
      sales_va: tiles.filter((t) => t.segment === "sales_va"),
      fulfillment: tiles.filter((t) => t.segment === "fulfillment"),
    };
  }, [tiles]);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">KPI Dashboard</h1>
          <p className="text-sm text-gray-500">
            Weekly accountability across Marketing, Sales/VA, and Fulfillment.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="px-2 py-1 rounded bg-green-950/40 border border-green-700/50 text-green-300">
            🟢 {summary.green}
          </span>
          <span className="px-2 py-1 rounded bg-yellow-950/40 border border-yellow-700/50 text-yellow-300">
            🟡 {summary.yellow}
          </span>
          <span className="px-2 py-1 rounded bg-red-950/40 border border-red-700/50 text-red-300">
            🔴 {summary.red}
          </span>
          {summary.none > 0 && (
            <span className="px-2 py-1 rounded bg-gray-900/40 border border-gray-800 text-gray-500">
              · {summary.none} pending
            </span>
          )}
        </div>
      </header>

      <div className="flex items-center justify-between mb-6">
        <p className="text-[10px] text-gray-600">
          Snapshot date: {asOf}. Computed nightly at 23:55 PHT.
        </p>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-800 hover:border-gray-600 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw size={12} className={recomputing ? "animate-spin" : ""} />
          {recomputing ? "Recomputing…" : "Recompute now"}
        </button>
      </div>

      <SegmentSection
        title="CEO Watch"
        description="Diagnostic metrics, not graded against targets."
        tiles={sections.watch}
        onTileClick={setActiveTile}
      />
      <SegmentSection
        title="Marketing"
        description="Creative testing volume + winner discovery."
        tiles={sections.marketing}
        onTileClick={setActiveTile}
      />
      <SegmentSection
        title="Sales / VA"
        description="Confirmation throughput + customer responsiveness."
        tiles={sections.sales_va}
        onTileClick={setActiveTile}
      />
      <SegmentSection
        title="Fulfillment"
        description="Pack quality + inventory accuracy."
        tiles={sections.fulfillment}
        onTileClick={setActiveTile}
      />

      <KpiDrilldown tile={activeTile} onClose={() => setActiveTile(null)} />
    </div>
  );
}
