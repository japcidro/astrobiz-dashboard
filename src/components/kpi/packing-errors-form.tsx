"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";

const ERROR_TYPES = [
  { value: "wrong_item", label: "Wrong item" },
  { value: "missing_item", label: "Missing item" },
  { value: "wrong_quantity", label: "Wrong quantity" },
  { value: "damaged", label: "Damaged" },
  { value: "missing_freebie", label: "Missing freebie" },
  { value: "late_ship", label: "Shipped late (>24h after confirm)" },
  { value: "other", label: "Other" },
];

interface Entry {
  id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  error_type: string;
  notes: string | null;
  occurred_on: string;
}

interface Employee {
  id: string;
  full_name: string;
  role: string;
}

interface PackingErrorsFormProps {
  packers: Employee[];
}

export function PackingErrorsForm({ packers }: PackingErrorsFormProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [orderId, setOrderId] = useState("");
  const [orderName, setOrderName] = useState("");
  const [errorType, setErrorType] = useState("wrong_item");
  const [packedBy, setPackedBy] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));

  const loadEntries = async () => {
    setLoading(true);
    const res = await fetch("/api/kpi/packing-errors", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setEntries(data.entries ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId.trim()) {
      setMessage("Order ID is required.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const res = await fetch("/api/kpi/packing-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopify_order_id: orderId.trim(),
        shopify_order_name: orderName.trim() || undefined,
        error_type: errorType,
        packed_by: packedBy || undefined,
        notes: notes.trim() || undefined,
        occurred_on: occurredOn,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage("Logged. Recomputing KPIs…");
      setOrderId("");
      setOrderName("");
      setNotes("");
      setErrorType("wrong_item");
      setPackedBy("");
      await fetch("/api/kpi/recompute", { method: "POST" });
      setMessage("Logged. KPI dashboard refreshed.");
      loadEntries();
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Packing Errors</h1>
          <p className="text-sm text-gray-500">
            EOD review log. Each entry counts against the
            <span className="text-gray-300"> perfect pack rate KPI</span>.
          </p>
        </div>
        <button onClick={loadEntries} className="text-gray-400 hover:text-white p-2 rounded cursor-pointer">
          <RefreshCw size={18} />
        </button>
      </div>

      <form
        onSubmit={submit}
        className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 mb-6 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">
            Shopify order ID
            <input
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. 5012345678901"
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              required
            />
          </label>
          <label className="text-xs text-gray-400">
            Order name (optional)
            <input
              type="text"
              value={orderName}
              onChange={(e) => setOrderName(e.target.value)}
              placeholder="e.g. #1234"
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="text-xs text-gray-400">
            Error type
            <select
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            >
              {ERROR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Packed by (optional)
            <select
              value={packedBy}
              onChange={(e) => setPackedBy(e.target.value)}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            >
              <option value="">—</option>
              {packers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Occurred on
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="text-xs text-gray-400 sm:col-span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              placeholder="Optional context"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-white text-gray-900 font-medium px-3 py-1.5 rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            {submitting ? "Logging…" : "Log error"}
          </button>
          {message && <span className="text-xs text-gray-400">{message}</span>}
        </div>
      </form>

      <h2 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
        <AlertTriangle size={14} /> Recent errors (14 days)
      </h2>
      <div className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-4 text-xs text-gray-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="p-4 text-xs text-gray-500">No errors logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {entries.map((e) => (
              <li key={e.id} className="p-3 text-xs text-gray-300">
                <div className="flex justify-between">
                  <span>
                    <span className="text-gray-500">{e.occurred_on}</span>
                    {" · "}
                    <span className="font-medium">{e.shopify_order_name ?? e.shopify_order_id}</span>
                    {" · "}
                    <span className="text-yellow-300">{e.error_type}</span>
                  </span>
                </div>
                {e.notes && <p className="text-gray-500 mt-1">{e.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
