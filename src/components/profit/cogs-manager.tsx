"use client";

import { useState, useRef } from "react";
import {
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Search,
} from "lucide-react";
import type { CogsItem } from "@/lib/profit/types";

interface Props {
  initialItems: CogsItem[];
}

export function CogsManager({ initialItems }: Props) {
  const [items, setItems] = useState<CogsItem[]>(initialItems);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add row form
  const [newStore, setNewStore] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newCogs, setNewCogs] = useState("");

  const stores = Array.from(new Set(items.map((i) => i.store_name))).sort();
  const filteredItems =
    storeFilter === "ALL"
      ? items
      : items.filter((i) => i.store_name === storeFilter);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleInlineEdit = (item: CogsItem) => {
    setEditingId(item.id);
    setEditValue(item.cogs_per_unit.toString());
  };

  const handleInlineSave = async (item: CogsItem) => {
    const newCost = parseFloat(editValue);
    if (isNaN(newCost) || newCost < 0) {
      setError("Invalid COGS value");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profit/cogs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, cogs_per_unit: newCost }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, cogs_per_unit: newCost } : i
        )
      );
      setEditingId(null);
      showSuccess("COGS updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this COGS item?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/profit/cogs?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete");
      setItems((prev) => prev.filter((i) => i.id !== id));
      showSuccess("Item deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      let parsedRows: Record<string, string>[] = [];
      const isXlsx = file.name.match(/\.xlsx?$/i);

      if (isXlsx) {
        // Parse XLSX/XLS using SheetJS (dynamic import to avoid SSR issues)
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        parsedRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      } else {
        // Parse CSV
        const text = await file.text();
        const lines = text.trim().split("\n");
        if (lines.length < 2) throw new Error("File must have a header row and at least one data row");
        const headers = lines[0].split(",").map((h) => h.trim());
        parsedRows = lines.slice(1).map((line) => {
          const cols = line.split(",").map((c) => c.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h] = cols[i] || ""; });
          return row;
        });
      }

      if (parsedRows.length === 0) throw new Error("No data rows found in file");

      // Map columns (case-insensitive)
      const items = parsedRows.map((row) => {
        const keys = Object.keys(row);
        const get = (target: string) => {
          const key = keys.find((k) => k.toLowerCase().trim() === target);
          return key ? String(row[key]).trim() : "";
        };
        return {
          store_name: get("store_name") || get("store"),
          sku: get("sku"),
          product_name: get("product_name") || get("product") || null,
          cogs_per_unit: parseFloat(get("cogs_per_unit") || get("cogs") || get("cost")) || 0,
        };
      }).filter((item) => item.sku); // skip rows without SKU

      if (items.length === 0) throw new Error("No valid rows found. File must have 'sku' and 'cogs_per_unit' (or 'cogs' or 'cost') columns.");

      const res = await fetch("/api/profit/cogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to import");

      showSuccess(`${items.length} items imported`);
      const refreshRes = await fetch("/api/profit/cogs");
      const refreshJson = await refreshRes.json();
      if (refreshRes.ok && refreshJson.items) {
        setItems(refreshJson.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import file");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleScanShopify = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/inventory?store=ALL");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch inventory");

      const rows = json.rows || json.inventory || [];
      const existingSkus = new Set(items.map((i) => i.sku));
      const newSkus: { store_name: string; sku: string; product_name: string | null; cogs_per_unit: number }[] = [];

      for (const row of rows) {
        const sku = row.sku || row.SKU;
        if (sku && !existingSkus.has(sku)) {
          existingSkus.add(sku);
          newSkus.push({
            store_name: row.store_name || row.store || "",
            sku,
            product_name: row.product_name || row.title || null,
            cogs_per_unit: 0,
          });
        }
      }

      if (newSkus.length === 0) {
        showSuccess("No new SKUs found");
        return;
      }

      const postRes = await fetch("/api/profit/cogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: newSkus }),
      });
      const postJson = await postRes.json();
      if (!postRes.ok) throw new Error(postJson.error || "Failed to save new SKUs");

      showSuccess(`${newSkus.length} new SKUs added (COGS = ₱0, update them!)`);
      // Refresh items
      const refreshRes = await fetch("/api/profit/cogs");
      const refreshJson = await refreshRes.json();
      if (refreshRes.ok && refreshJson.items) {
        setItems(refreshJson.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to scan Shopify");
    } finally {
      setScanning(false);
    }
  };

  const handleAddRow = async () => {
    if (!newSku.trim()) {
      setError("SKU is required");
      return;
    }
    const cogsVal = parseFloat(newCogs);
    if (isNaN(cogsVal) || cogsVal < 0) {
      setError("Invalid COGS value");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profit/cogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              store_name: newStore.trim(),
              sku: newSku.trim(),
              product_name: newName.trim() || null,
              cogs_per_unit: cogsVal,
            },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add item");

      showSuccess("Item added");
      setNewStore("");
      setNewSku("");
      setNewName("");
      setNewCogs("");
      // Refresh items
      const refreshRes = await fetch("/api/profit/cogs");
      const refreshJson = await refreshRes.json();
      if (refreshRes.ok && refreshJson.items) {
        setItems(refreshJson.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600/20 rounded-lg">
              <Search size={20} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                COGS Items ({filteredItems.length})
              </h2>
              <p className="text-sm text-gray-400">
                Cost of goods sold per SKU
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Stores</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={handleScanShopify}
              disabled={scanning}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {scanning ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Scan from Shopify
            </button>
          </div>
        </div>

        {/* Alerts */}
        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* File Upload (CSV or XLSX) */}
        <div className="mb-6 bg-gray-700/30 border border-gray-600/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-2 font-medium">Import from File</p>
          <p className="text-xs text-gray-500 mb-3">
            Upload CSV or XLSX with columns: store_name, sku, product_name, cogs_per_unit
          </p>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-gray-700 file:text-white hover:file:bg-gray-600 file:cursor-pointer"
            />
            {importing && (
              <RefreshCw size={16} className="animate-spin text-emerald-400" />
            )}
          </div>
        </div>

        {/* Table */}
        {filteredItems.length === 0 ? (
          <div className="py-6 text-center text-gray-500 text-sm">
            No COGS items yet. Add items manually, upload a file (CSV/XLSX), or scan from Shopify.
          </div>
        ) : (
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                  <th className="text-left px-3 py-2 font-medium">Store</th>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium">Product Name</th>
                  <th className="text-left px-3 py-2 font-medium">COGS/Unit (₱)</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-800 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-3 text-gray-300 whitespace-nowrap">
                      {item.store_name || "—"}
                    </td>
                    <td className="px-3 py-3 text-white font-mono text-xs whitespace-nowrap">
                      {item.sku}
                    </td>
                    <td className="px-3 py-3 text-gray-300">
                      {item.product_name || "—"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {editingId === item.id ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleInlineSave(item);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => handleInlineSave(item)}
                          autoFocus
                          className="w-24 bg-gray-800 border border-emerald-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => handleInlineEdit(item)}
                          className="text-white hover:text-emerald-400 transition-colors cursor-pointer"
                        >
                          ₱{item.cogs_per_unit.toFixed(2)}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Row Form */}
        <div className="bg-gray-700/30 border border-gray-600/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-3 font-medium flex items-center gap-1.5">
            <Plus size={14} />
            Add New Item
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              type="text"
              value={newStore}
              onChange={(e) => setNewStore(e.target.value)}
              placeholder="Store name"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="text"
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              placeholder="SKU *"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Product name"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={newCogs}
              onChange={(e) => setNewCogs(e.target.value)}
              placeholder="COGS/unit"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={handleAddRow}
              disabled={saving || !newSku.trim()}
              className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
