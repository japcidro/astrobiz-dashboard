"use client";

import { useEffect, useState } from "react";
import { Save, RefreshCw } from "lucide-react";

interface Row {
  sku: string;
  product_name: string | null;
  expected_qty: number;
  already_counted: { actual_qty: number; notes: string | null } | null;
  actual_input: string;
  notes_input: string;
}

export function StockCountForm() {
  const [weekStarting, setWeekStarting] = useState<string>(mondayOfThisWeek());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/kpi/stock-count?week_starting=${weekStarting}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`Error: ${data.error}`);
      setRows([]);
    } else {
      const mapped: Row[] = (data.rows ?? []).map((r: Row) => ({
        sku: r.sku,
        product_name: r.product_name,
        expected_qty: r.expected_qty,
        already_counted: r.already_counted ?? null,
        actual_input: r.already_counted ? String(r.already_counted.actual_qty) : "",
        notes_input: r.already_counted?.notes ?? "",
      }));
      setRows(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStarting]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const entries = rows
      .filter((r) => r.actual_input !== "")
      .map((r) => ({
        sku: r.sku,
        expected_qty: r.expected_qty,
        actual_qty: Number(r.actual_input),
        notes: r.notes_input || undefined,
      }));
    if (entries.length === 0) {
      setMessage("Enter at least one count.");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/kpi/stock-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_starting: weekStarting, entries }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage(`Saved ${data.saved} entries. Recomputing KPIs…`);
      await fetch("/api/kpi/recompute", { method: "POST" });
      setMessage(`Saved ${data.saved} entries. KPI dashboard refreshed.`);
      load();
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Stock Count</h1>
          <p className="text-sm text-gray-500">
            Sunday physical count vs. system inventory. Logs feed the
            <span className="text-gray-300"> stock variance KPI</span>.
          </p>
        </div>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white p-2 rounded cursor-pointer"
          title="Reload"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs text-gray-500">Week of (Mon):</label>
        <input
          type="date"
          value={weekStarting}
          onChange={(e) => setWeekStarting(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
        />
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && rows.length === 0 && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-400 mb-2">No SKUs in the watchlist yet.</p>
          <p className="text-xs text-gray-500">
            Admin must add the top 20 SKUs to <code className="text-gray-300">stock_count_watchlist</code> first.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left p-3">SKU / Product</th>
                  <th className="text-right p-3 w-28">Expected</th>
                  <th className="text-right p-3 w-32">Actual</th>
                  <th className="text-left p-3 w-48">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((r, idx) => (
                  <tr key={r.sku}>
                    <td className="p-3">
                      <p className="text-gray-200">{r.sku}</p>
                      {r.product_name && (
                        <p className="text-[10px] text-gray-500">{r.product_name}</p>
                      )}
                    </td>
                    <td className="p-3 text-right text-gray-400">{r.expected_qty}</td>
                    <td className="p-3">
                      <input
                        type="number"
                        value={r.actual_input}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, actual_input: e.target.value } : x)),
                          )
                        }
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-right text-white"
                        placeholder="—"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="text"
                        value={r.notes_input}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, notes_input: e.target.value } : x)),
                          )
                        }
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                        placeholder="optional"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-white text-gray-900 font-medium px-4 py-2 rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              {saving ? "Saving…" : "Save counts"}
            </button>
            {message && <span className="text-xs text-gray-400">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function mondayOfThisWeek(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(now.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}
