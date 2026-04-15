"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Pencil, Trash2, Search, X, Check } from "lucide-react";

interface BinLocation {
  id: string;
  sku: string;
  product_title: string | null;
  bin_code: string;
  zone: string;
  notes: string | null;
  store: string;
  created_at: string;
}

const ZONES = ["A", "B", "C", "D", "E", "Overflow", "Returns"];

const EMPTY_FORM = {
  sku: "",
  bin_code: "",
  zone: "A",
  notes: "",
  store: "ALL",
};

export default function BinsPage() {
  const supabase = createClient();

  const [bins, setBins] = useState<BinLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchBins = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("bin_locations")
      .select("*")
      .order("bin_code", { ascending: true });

    if (storeFilter !== "ALL") {
      query = query.eq("store", storeFilter);
    }

    const { data, error } = await query;
    if (!error && data) {
      setBins(data as BinLocation[]);
    }
    setLoading(false);
  }, [storeFilter, supabase]);

  useEffect(() => {
    fetchBins();
  }, [fetchBins]);

  const filtered = bins.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.sku.toLowerCase().includes(q) ||
      b.bin_code.toLowerCase().includes(q) ||
      (b.product_title?.toLowerCase().includes(q) ?? false)
    );
  });

  async function handleAdd() {
    if (!form.sku.trim() || !form.bin_code.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("bin_locations").upsert(
      {
        sku: form.sku.trim(),
        bin_code: form.bin_code.trim().toUpperCase(),
        zone: form.zone,
        notes: form.notes.trim() || null,
        store: form.store === "ALL" ? storeFilter : form.store,
      },
      { onConflict: "sku,store" }
    );
    if (!error) {
      setForm(EMPTY_FORM);
      setShowAdd(false);
      fetchBins();
    }
    setSaving(false);
  }

  async function handleEdit(id: string) {
    if (!editForm.sku.trim() || !editForm.bin_code.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("bin_locations")
      .update({
        sku: editForm.sku.trim(),
        bin_code: editForm.bin_code.trim().toUpperCase(),
        zone: editForm.zone,
        notes: editForm.notes.trim() || null,
      })
      .eq("id", id);
    if (!error) {
      setEditId(null);
      fetchBins();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const { error } = await supabase
      .from("bin_locations")
      .delete()
      .eq("id", id);
    if (!error) {
      setDeleteId(null);
      fetchBins();
    }
  }

  function startEdit(bin: BinLocation) {
    setEditId(bin.id);
    setEditForm({
      sku: bin.sku,
      bin_code: bin.bin_code,
      zone: bin.zone,
      notes: bin.notes ?? "",
      store: bin.store,
    });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Bin Locations</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage shelf locations for products
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="ALL">All Stores</option>
          <option value="STORE_1">Store 1</option>
          <option value="STORE_2">Store 2</option>
        </select>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            placeholder="Search SKU or bin code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg pl-9 pr-3 py-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <button
          onClick={() => setShowAdd(!showAdd)}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Add Bin Location
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            New Bin Location
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="Bin Code (e.g. A-01)"
              value={form.bin_code}
              onChange={(e) => setForm({ ...form, bin_code: e.target.value })}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <select
              value={form.zone}
              onChange={(e) => setForm({ ...form, zone: e.target.value })}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setForm(EMPTY_FORM);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm px-3 py-2 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-700/50">
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  SKU
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  Product
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  Bin Code
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  Zone
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  Notes
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="h-4 w-32 mx-auto bg-gray-700/50 rounded animate-pulse" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    No bin locations found
                  </td>
                </tr>
              ) : (
                filtered.map((bin) => (
                  <tr
                    key={bin.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20"
                  >
                    {editId === bin.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.sku}
                            onChange={(e) =>
                              setEditForm({ ...editForm, sku: e.target.value })
                            }
                            className="w-full bg-gray-900 border border-gray-600 text-gray-300 text-sm rounded px-2 py-1"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {bin.product_title ?? "-"}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.bin_code}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                bin_code: e.target.value,
                              })
                            }
                            className="w-full bg-gray-900 border border-gray-600 text-gray-300 text-sm rounded px-2 py-1"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={editForm.zone}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                zone: e.target.value,
                              })
                            }
                            className="bg-gray-900 border border-gray-600 text-gray-300 text-sm rounded px-2 py-1"
                          >
                            {ZONES.map((z) => (
                              <option key={z} value={z}>
                                {z}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.notes}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                notes: e.target.value,
                              })
                            }
                            className="w-full bg-gray-900 border border-gray-600 text-gray-300 text-sm rounded px-2 py-1"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEdit(bin.id)}
                              disabled={saving}
                              className="p-1.5 text-green-400 hover:bg-green-500/10 rounded transition-colors"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditId(null)}
                              className="p-1.5 text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                          {bin.sku}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {bin.product_title ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-blue-500/10 text-blue-400 text-xs font-mono px-2 py-0.5 rounded">
                            {bin.bin_code}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {bin.zone}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {bin.notes ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEdit(bin)}
                              className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            {deleteId === bin.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(bin.id)}
                                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setDeleteId(null)}
                                  className="text-xs text-gray-400 px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteId(bin.id)}
                                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && (
          <div className="px-4 py-3 border-t border-gray-700/50 text-xs text-gray-500">
            {filtered.length} location{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
