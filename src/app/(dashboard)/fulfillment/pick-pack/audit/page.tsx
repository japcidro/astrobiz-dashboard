"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, Undo2, Loader2 } from "lucide-react";

type Tab = "adjustments" | "verifications";

interface Adjustment {
  id: string;
  created_at: string;
  sku: string;
  product_title: string | null;
  type: string;
  previous_quantity: number;
  new_quantity: number;
  change: number;
  reason: string | null;
  adjusted_by: string | null;
}

interface Verification {
  id: string;
  completed_at: string;
  order_number: string;
  store_name: string;
  status: string;
  source: "scan" | "manual_clear" | "backfill";
  items_expected: number;
  items_scanned: number;
  mismatch_count: number;
  notes: string | null;
  verified_by_name: string | null;
}

const TYPE_BADGES: Record<string, { bg: string; text: string; label: string }> =
  {
    stock_in: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      label: "Stock In",
    },
    manual_set: {
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      label: "Manual Set",
    },
    manual_adjust: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      label: "Manual Adjust",
    },
    cycle_count: {
      bg: "bg-purple-500/10",
      text: "text-purple-400",
      label: "Cycle Count",
    },
  };

const STATUS_BADGES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  verified: { bg: "bg-green-500/10", text: "text-green-400", label: "Verified" },
  mismatch_corrected: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    label: "Corrected",
  },
  failed: { bg: "bg-red-500/10", text: "text-red-400", label: "Failed" },
  manual_cleared: {
    bg: "bg-gray-500/10",
    text: "text-gray-400",
    label: "Manual Clear",
  },
};

const SOURCE_BADGES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  scan: { bg: "bg-blue-500/10", text: "text-blue-300", label: "Scan" },
  manual_clear: {
    bg: "bg-orange-500/10",
    text: "text-orange-300",
    label: "Manual Clear",
  },
  backfill: {
    bg: "bg-purple-500/10",
    text: "text-purple-300",
    label: "Backfill",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditPage() {
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>("adjustments");
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loadingAdj, setLoadingAdj] = useState(true);
  const [loadingVer, setLoadingVer] = useState(true);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchAdj, setSearchAdj] = useState("");
  const [searchVer, setSearchVer] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "ALL" | "scan" | "manual_clear" | "backfill"
  >("ALL");
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [verError, setVerError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAdjustments() {
      setLoadingAdj(true);
      const { data } = await supabase
        .from("inventory_adjustments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      setAdjustments((data as Adjustment[]) ?? []);
      setLoadingAdj(false);
    }
    fetchAdjustments();
  }, [supabase]);

  const fetchVerifications = useCallback(async () => {
    setLoadingVer(true);
    setVerError(null);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== "ALL") params.set("source", sourceFilter);
      if (searchVer) params.set("q", searchVer);
      const res = await fetch(
        `/api/shopify/fulfillment/verifications?${params.toString()}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setVerifications((json.rows as Verification[]) ?? []);
    } catch (e) {
      setVerError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingVer(false);
    }
  }, [sourceFilter, searchVer]);

  useEffect(() => {
    fetchVerifications();
  }, [fetchVerifications]);

  async function handleUndo(v: Verification) {
    if (v.source !== "manual_clear") return;
    const confirmed = window.confirm(
      `Undo manual clear for order ${v.order_number}?\n\nThis order will return to the Pick & Pack list.`
    );
    if (!confirmed) return;
    setUndoingId(v.id);
    try {
      const res = await fetch("/api/shopify/fulfillment/manual-clear/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [v.id] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Undo failed");
      await fetchVerifications();
    } catch (e) {
      setVerError(e instanceof Error ? e.message : "Undo failed");
    } finally {
      setUndoingId(null);
    }
  }

  const filteredAdj = adjustments.filter((a) => {
    if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
    if (!searchAdj) return true;
    const q = searchAdj.toLowerCase();
    return (
      a.sku.toLowerCase().includes(q) ||
      (a.product_title?.toLowerCase().includes(q) ?? false)
    );
  });

  const filteredVer = verifications;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Audit Trail</h1>
        <p className="text-sm text-gray-400 mt-1">
          Inventory adjustments and pack verification history
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("adjustments")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "adjustments"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Adjustments
        </button>
        <button
          onClick={() => setTab("verifications")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "verifications"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Verifications
        </button>
      </div>

      {/* Adjustments Tab */}
      {tab === "adjustments" && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="ALL">All Types</option>
              <option value="stock_in">Stock In</option>
              <option value="manual_set">Manual Set</option>
              <option value="manual_adjust">Manual Adjust</option>
              <option value="cycle_count">Cycle Count</option>
            </select>
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                type="text"
                placeholder="Search by SKU..."
                value={searchAdj}
                onChange={(e) => setSearchAdj(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg pl-9 pr-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-700/50">
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      SKU
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Product
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Type
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Previous
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      New
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Change
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Reason
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      By
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAdj ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center">
                        <div className="h-4 w-32 mx-auto bg-gray-700/50 rounded animate-pulse" />
                      </td>
                    </tr>
                  ) : filteredAdj.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        No adjustments found
                      </td>
                    </tr>
                  ) : (
                    filteredAdj.map((a) => {
                      const badge = TYPE_BADGES[a.type] ?? {
                        bg: "bg-gray-500/10",
                        text: "text-gray-400",
                        label: a.type,
                      };
                      return (
                        <tr
                          key={a.id}
                          className="border-b border-gray-700/30 hover:bg-gray-700/20"
                        >
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {formatDate(a.created_at)}
                          </td>
                          <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                            {a.sku}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs max-w-[160px] truncate">
                            {a.product_title ?? "-"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`${badge.bg} ${badge.text} text-xs px-2 py-0.5 rounded`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-right font-mono text-xs">
                            {a.previous_quantity}
                          </td>
                          <td className="px-4 py-3 text-gray-300 text-right font-mono text-xs">
                            {a.new_quantity}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            <span
                              className={
                                a.change > 0
                                  ? "text-green-400"
                                  : a.change < 0
                                    ? "text-red-400"
                                    : "text-gray-400"
                              }
                            >
                              {a.change > 0 ? "+" : ""}
                              {a.change}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[120px] truncate">
                            {a.reason ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {a.adjusted_by ?? "-"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!loadingAdj && (
              <div className="px-4 py-3 border-t border-gray-700/50 text-xs text-gray-500">
                {filteredAdj.length} adjustment
                {filteredAdj.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </>
      )}

      {/* Verifications Tab */}
      {tab === "verifications" && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(
                  e.target.value as "ALL" | "scan" | "manual_clear" | "backfill"
                )
              }
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="ALL">All sources</option>
              <option value="scan">Scan</option>
              <option value="manual_clear">Manual Clear</option>
              <option value="backfill">Backfill</option>
            </select>
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                type="text"
                placeholder="Search by order #..."
                value={searchVer}
                onChange={(e) => setSearchVer(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg pl-9 pr-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {verError && (
            <div className="mb-3 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {verError}
            </div>
          )}

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-700/50">
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Order #
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Store
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Source
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Exp
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Scan
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Mis
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      By
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                      Notes
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingVer ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center">
                        <div className="h-4 w-32 mx-auto bg-gray-700/50 rounded animate-pulse" />
                      </td>
                    </tr>
                  ) : filteredVer.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        No verifications found
                      </td>
                    </tr>
                  ) : (
                    filteredVer.map((v) => {
                      const statusBadge = STATUS_BADGES[v.status] ?? {
                        bg: "bg-gray-500/10",
                        text: "text-gray-400",
                        label: v.status,
                      };
                      const sourceBadge = SOURCE_BADGES[v.source] ?? {
                        bg: "bg-gray-500/10",
                        text: "text-gray-400",
                        label: v.source,
                      };
                      return (
                        <tr
                          key={v.id}
                          className="border-b border-gray-700/30 hover:bg-gray-700/20"
                        >
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {formatDate(v.completed_at)}
                          </td>
                          <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                            {v.order_number}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {v.store_name}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`${sourceBadge.bg} ${sourceBadge.text} text-xs px-2 py-0.5 rounded`}
                            >
                              {sourceBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`${statusBadge.bg} ${statusBadge.text} text-xs px-2 py-0.5 rounded`}
                            >
                              {statusBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-right font-mono text-xs">
                            {v.items_expected}
                          </td>
                          <td className="px-4 py-3 text-gray-300 text-right font-mono text-xs">
                            {v.items_scanned}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            <span
                              className={
                                v.mismatch_count > 0
                                  ? "text-red-400"
                                  : "text-green-400"
                              }
                            >
                              {v.mismatch_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-300 text-xs max-w-[120px] truncate">
                            {v.verified_by_name ?? "-"}
                          </td>
                          <td
                            className="px-4 py-3 text-gray-500 text-xs max-w-[180px] truncate"
                            title={v.notes ?? undefined}
                          >
                            {v.notes ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {v.source === "manual_clear" ? (
                              <button
                                onClick={() => handleUndo(v)}
                                disabled={undoingId === v.id}
                                title="Return this order to the Pick & Pack list"
                                className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 disabled:opacity-40 cursor-pointer"
                              >
                                {undoingId === v.id ? (
                                  <Loader2
                                    size={12}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Undo2 size={12} />
                                )}
                                Undo
                              </button>
                            ) : (
                              <span className="text-gray-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!loadingVer && (
              <div className="px-4 py-3 border-t border-gray-700/50 text-xs text-gray-500">
                {filteredVer.length} verification
                {filteredVer.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
