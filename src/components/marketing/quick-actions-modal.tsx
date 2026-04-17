"use client";

import { useState, useMemo } from "react";
import { X, Loader2, Zap, AlertTriangle, TrendingUp } from "lucide-react";

interface AdRow {
  account: string;
  campaign: string;
  campaign_id: string;
  adset: string;
  adset_id: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  cpa: number;
  purchases: number;
  start_time: string | null;
}

interface BudgetInfo {
  daily_budget: number | null;
  lifetime_budget: number | null;
}

interface AdsetTarget {
  id: string;
  name: string;
  spend: number;
  purchases: number;
  cpa: number;
  current_budget: number;
  new_budget: number;
  is_daily: boolean;
  days_running: number | null;
}

interface AdTarget {
  id: string;
  name: string;
  adset_name: string;
  spend: number;
  purchases: number;
  cpa: number;
  days_running: number | null;
}

interface ExecResult {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

const fmt = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function QuickActionsModal({
  open,
  onClose,
  rows,
  budgets,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  rows: AdRow[];
  budgets: Record<string, BudgetInfo>;
  onComplete: () => void;
}) {
  const [tab, setTab] = useState<"kill" | "boost">("kill");

  // Kill bleeders config
  const [killSpendMin, setKillSpendMin] = useState(380);
  const [killCpaMax, setKillCpaMax] = useState(380);

  // Boost winners config
  const [boostCpaMax, setBoostCpaMax] = useState(200);
  const [boostMinPurchases, setBoostMinPurchases] = useState(2);
  const [boostPercent, setBoostPercent] = useState(20);

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ExecResult[] | null>(null);

  // Bleeders: ad-level — currently ACTIVE, spend >= killSpendMin AND
  // (no purchases OR cpa > killCpaMax)
  const bleeders = useMemo<AdTarget[]>(() => {
    return rows
      .filter((r) => r.status === "ACTIVE")
      .filter((r) => {
        const noPurchase = r.purchases === 0 && r.spend >= killSpendMin;
        const highCpa = r.purchases > 0 && r.cpa > killCpaMax;
        return noPurchase || highCpa;
      })
      .map((r) => ({
        id: r.ad_id,
        name: r.ad,
        adset_name: r.adset,
        spend: r.spend,
        purchases: r.purchases,
        cpa: r.cpa,
        days_running: r.start_time
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(r.start_time).getTime()) / 86400000
              )
            )
          : null,
      }));
  }, [rows, killSpendMin, killCpaMax]);

  // Winners: aggregate by adset, where adset is currently ACTIVE,
  // cpa <= boostCpaMax AND purchases >= boostMinPurchases
  const winners = useMemo<AdsetTarget[]>(() => {
    const byAdset = new Map<
      string,
      { name: string; spend: number; purchases: number; start_time: string | null }
    >();
    for (const r of rows) {
      if (r.status !== "ACTIVE") continue;
      const k = r.adset_id;
      if (!byAdset.has(k)) {
        byAdset.set(k, {
          name: r.adset,
          spend: 0,
          purchases: 0,
          start_time: r.start_time,
        });
      }
      const entry = byAdset.get(k)!;
      entry.spend += r.spend;
      entry.purchases += r.purchases;
    }

    const result: AdsetTarget[] = [];
    for (const [id, agg] of byAdset) {
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
      if (agg.purchases < boostMinPurchases) continue;
      if (cpa > boostCpaMax) continue;
      const b = budgets[id];
      if (!b) continue;
      const current = b.daily_budget ?? b.lifetime_budget ?? 0;
      if (current <= 0) continue;
      const newBudget = Math.round(current * (1 + boostPercent / 100));
      const days = agg.start_time
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(agg.start_time).getTime()) / 86400000
            )
          )
        : null;
      result.push({
        id,
        name: agg.name,
        spend: agg.spend,
        purchases: agg.purchases,
        cpa,
        current_budget: current,
        new_budget: newBudget,
        is_daily: b.daily_budget != null,
        days_running: days,
      });
    }
    return result.sort((a, b) => a.cpa - b.cpa);
  }, [rows, budgets, boostCpaMax, boostMinPurchases, boostPercent]);

  const executeKill = async () => {
    setExecuting(true);
    setResults(null);
    const out: ExecResult[] = [];
    // Process in batches of 5 to avoid FB rate limits
    const batchSize = 5;
    for (let i = 0; i < bleeders.length; i += batchSize) {
      const batch = bleeders.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map(async (b) => {
          const res = await fetch("/api/facebook/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "toggle_status",
              entity_id: b.id,
              new_status: "PAUSED",
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed");
          return b;
        })
      );
      settled.forEach((s, idx) => {
        const b = batch[idx];
        out.push({
          id: b.id,
          name: b.name,
          ok: s.status === "fulfilled",
          error: s.status === "rejected" ? String(s.reason?.message || s.reason) : undefined,
        });
      });
      setResults([...out]);
    }
    setExecuting(false);
    onComplete();
  };

  const executeBoost = async () => {
    setExecuting(true);
    setResults(null);
    const out: ExecResult[] = [];
    const batchSize = 5;
    for (let i = 0; i < winners.length; i += batchSize) {
      const batch = winners.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map(async (w) => {
          const body: Record<string, unknown> = {
            action: "update_budget",
            entity_id: w.id,
          };
          if (w.is_daily) body.daily_budget = w.new_budget;
          else body.lifetime_budget = w.new_budget;

          const res = await fetch("/api/facebook/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed");
          return w;
        })
      );
      settled.forEach((s, idx) => {
        const w = batch[idx];
        out.push({
          id: w.id,
          name: w.name,
          ok: s.status === "fulfilled",
          error: s.status === "rejected" ? String(s.reason?.message || s.reason) : undefined,
        });
      });
      setResults([...out]);
    }
    setExecuting(false);
    onComplete();
  };

  if (!open) return null;

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const failCount = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-yellow-400" />
            <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
            <span className="text-xs text-gray-500 ml-2">
              Scoped to currently visible data
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => {
              setTab("kill");
              setResults(null);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              tab === "kill"
                ? "text-red-400 border-b-2 border-red-400 bg-red-900/10"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <AlertTriangle size={14} />
            Kill Bleeders
          </button>
          <button
            onClick={() => {
              setTab("boost");
              setResults(null);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              tab === "boost"
                ? "text-green-400 border-b-2 border-green-400 bg-green-900/10"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <TrendingUp size={14} />
            Boost Winners
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "kill" ? (
            <div>
              <p className="text-sm text-gray-400 mb-4">
                Pauses ACTIVE ads where{" "}
                <span className="text-white">spend ≥ ₱{killSpendMin}</span> with
                no purchases, OR{" "}
                <span className="text-white">CPA &gt; ₱{killCpaMax}</span>.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Min spend (₱)
                  </label>
                  <input
                    type="number"
                    value={killSpendMin}
                    onChange={(e) => setKillSpendMin(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Max CPA (₱)
                  </label>
                  <input
                    type="number"
                    value={killCpaMax}
                    onChange={(e) => setKillCpaMax(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>

              <div className="text-sm text-white mb-2">
                {bleeders.length} ad{bleeders.length !== 1 ? "s" : ""} match
              </div>
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/50 sticky top-0">
                      <tr className="text-gray-400">
                        <th className="text-left px-3 py-2">Ad</th>
                        <th className="text-right px-3 py-2">Days</th>
                        <th className="text-right px-3 py-2">Spent</th>
                        <th className="text-right px-3 py-2">Pur</th>
                        <th className="text-right px-3 py-2">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bleeders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center text-gray-500 py-6">
                            Nothing to kill — no ads match the criteria
                          </td>
                        </tr>
                      ) : (
                        bleeders.map((b) => {
                          const result = results?.find((r) => r.id === b.id);
                          return (
                            <tr
                              key={b.id}
                              className={`border-t border-gray-800 ${
                                result?.ok
                                  ? "bg-green-900/10"
                                  : result && !result.ok
                                    ? "bg-red-900/20"
                                    : ""
                              }`}
                            >
                              <td className="px-3 py-2 text-gray-200">
                                <div className="truncate max-w-[300px]" title={b.name}>
                                  {b.name}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate">
                                  {b.adset_name}
                                </div>
                                {result?.error && (
                                  <div className="text-[10px] text-red-400 mt-0.5">
                                    {result.error}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {b.days_running == null
                                  ? "—"
                                  : b.days_running === 0
                                    ? "Today"
                                    : `${b.days_running}d`}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {fmt(b.spend)}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {b.purchases}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {b.cpa > 0 ? fmt(b.cpa) : "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-4">
                Increases daily/lifetime budget by{" "}
                <span className="text-white">{boostPercent}%</span> for ACTIVE
                adsets with{" "}
                <span className="text-white">CPA ≤ ₱{boostCpaMax}</span> and{" "}
                <span className="text-white">≥ {boostMinPurchases} purchases</span>.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Max CPA (₱)
                  </label>
                  <input
                    type="number"
                    value={boostCpaMax}
                    onChange={(e) => setBoostCpaMax(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Min purchases
                  </label>
                  <input
                    type="number"
                    value={boostMinPurchases}
                    onChange={(e) =>
                      setBoostMinPurchases(parseInt(e.target.value) || 0)
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Increase %
                  </label>
                  <input
                    type="number"
                    value={boostPercent}
                    onChange={(e) => setBoostPercent(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>

              <div className="text-sm text-white mb-2">
                {winners.length} adset{winners.length !== 1 ? "s" : ""} match
              </div>
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/50 sticky top-0">
                      <tr className="text-gray-400">
                        <th className="text-left px-3 py-2">Ad Set</th>
                        <th className="text-right px-3 py-2">Days</th>
                        <th className="text-right px-3 py-2">CPA</th>
                        <th className="text-right px-3 py-2">Pur</th>
                        <th className="text-right px-3 py-2">Budget</th>
                        <th className="text-right px-3 py-2">→ New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {winners.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center text-gray-500 py-6">
                            No adsets match the criteria
                          </td>
                        </tr>
                      ) : (
                        winners.map((w) => {
                          const result = results?.find((r) => r.id === w.id);
                          return (
                            <tr
                              key={w.id}
                              className={`border-t border-gray-800 ${
                                result?.ok
                                  ? "bg-green-900/10"
                                  : result && !result.ok
                                    ? "bg-red-900/20"
                                    : ""
                              }`}
                            >
                              <td className="px-3 py-2 text-gray-200">
                                <div className="truncate max-w-[280px]" title={w.name}>
                                  {w.name}
                                </div>
                                {result?.error && (
                                  <div className="text-[10px] text-red-400 mt-0.5">
                                    {result.error}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {w.days_running == null
                                  ? "—"
                                  : w.days_running === 0
                                    ? "Today"
                                    : `${w.days_running}d`}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {fmt(w.cpa)}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {w.purchases}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-300">
                                {fmt(w.current_budget)}
                              </td>
                              <td className="px-3 py-2 text-right text-green-400 font-medium">
                                {fmt(w.new_budget)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {results && results.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-gray-800/50 text-sm">
              <span className="text-green-400">{okCount} succeeded</span>
              {failCount > 0 && (
                <>
                  {" · "}
                  <span className="text-red-400">{failCount} failed</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-800">
          <button
            onClick={onClose}
            disabled={executing}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            Close
          </button>
          {tab === "kill" ? (
            <button
              onClick={executeKill}
              disabled={executing || bleeders.length === 0}
              className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {executing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <AlertTriangle size={14} />
              )}
              {executing
                ? `Pausing ${results?.length ?? 0}/${bleeders.length}...`
                : `Pause ${bleeders.length} ad${bleeders.length !== 1 ? "s" : ""}`}
            </button>
          ) : (
            <button
              onClick={executeBoost}
              disabled={executing || winners.length === 0}
              className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {executing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <TrendingUp size={14} />
              )}
              {executing
                ? `Boosting ${results?.length ?? 0}/${winners.length}...`
                : `Boost ${winners.length} adset${winners.length !== 1 ? "s" : ""} +${boostPercent}%`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
