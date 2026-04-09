"use client";

import { useState, useTransition } from "react";
import {
  Store,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  CheckCircle,
  X,
} from "lucide-react";
import type { ShopifyStore } from "@/lib/shopify/types";
import {
  addShopifyStore,
  updateShopifyStore,
  deleteShopifyStore,
  toggleShopifyStore,
  testShopifyConnection,
} from "@/lib/shopify/actions";

interface Props {
  stores: ShopifyStore[];
}

interface FormState {
  name: string;
  store_url: string;
  api_token: string;
}

const emptyForm: FormState = { name: "", store_url: "", api_token: "" };

export function StoreManager({ stores: initialStores }: Props) {
  const [stores, setStores] = useState<ShopifyStore[]>(initialStores);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const resetForm = () => {
    setForm(emptyForm);
    setShowAdd(false);
    setEditingId(null);
    setTestResult(null);
    setError(null);
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleTestConnection = async () => {
    if (!form.store_url || !form.api_token) {
      setTestResult({ ok: false, message: "Store URL and API token are required" });
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testShopifyConnection(form.store_url, form.api_token);
      if (result.error) {
        setTestResult({ ok: false, message: result.error });
      } else {
        setTestResult({
          ok: true,
          message: `Connected! Shop: ${result.shop_name}`,
        });
      }
    } catch {
      setTestResult({ ok: false, message: "Failed to test connection" });
    } finally {
      setTestLoading(false);
    }
  };

  const handleAdd = () => {
    setError(null);
    const formData = new FormData();
    formData.set("name", form.name);
    formData.set("store_url", form.store_url);
    formData.set("api_token", form.api_token);

    startTransition(async () => {
      const result = await addShopifyStore(formData);
      if (result.error) {
        setError(result.error);
      } else {
        showSuccess("Store added successfully");
        window.location.reload();
      }
    });
  };

  const handleUpdate = () => {
    if (!editingId) return;
    setError(null);
    const formData = new FormData();
    formData.set("name", form.name);
    formData.set("store_url", form.store_url);
    formData.set("api_token", form.api_token);

    startTransition(async () => {
      const result = await updateShopifyStore(editingId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        showSuccess("Store updated successfully");
        window.location.reload();
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this store?")) return;
    setDeletingId(id);
    setError(null);
    try {
      const result = await deleteShopifyStore(id);
      if (result.error) {
        setError(result.error);
      } else {
        setStores((prev) => prev.filter((s) => s.id !== id));
        showSuccess("Store deleted");
      }
    } catch {
      setError("Failed to delete store");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    setTogglingId(id);
    setError(null);
    try {
      const result = await toggleShopifyStore(id, !currentActive);
      if (result.error) {
        setError(result.error);
      } else {
        setStores((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, is_active: !currentActive } : s
          )
        );
        showSuccess(`Store ${!currentActive ? "activated" : "deactivated"}`);
      }
    } catch {
      setError("Failed to toggle store");
    } finally {
      setTogglingId(null);
    }
  };

  const startEdit = (store: ShopifyStore) => {
    setEditingId(store.id);
    setShowAdd(false);
    setForm({
      name: store.name,
      store_url: store.store_url,
      api_token: store.api_token,
    });
    setTestResult(null);
    setError(null);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600/20 rounded-lg">
              <Store size={20} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Shopify Stores ({stores.length})
              </h2>
              <p className="text-sm text-gray-400">
                Manage your connected Shopify stores
              </p>
            </div>
          </div>
          {!showAdd && !editingId && (
            <button
              onClick={() => {
                setShowAdd(true);
                setForm(emptyForm);
                setTestResult(null);
                setError(null);
              }}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <Plus size={14} />
              Add Store
            </button>
          )}
        </div>

        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Store list */}
        {stores.length === 0 && !showAdd && (
          <div className="py-6 text-center text-gray-500 text-sm">
            No stores connected yet. Click &quot;Add Store&quot; to get started.
          </div>
        )}

        {stores.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">URL</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr
                    key={store.id}
                    className="border-b border-gray-800 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-3 text-white font-medium">
                      {store.name}
                    </td>
                    <td className="px-3 py-3 text-gray-400 font-mono text-xs">
                      {store.store_url}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          store.is_active
                            ? "bg-green-900/30 text-green-400"
                            : "bg-gray-700/50 text-gray-400"
                        }`}
                      >
                        {store.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(store)}
                          className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() =>
                            handleToggle(store.id, store.is_active)
                          }
                          disabled={togglingId === store.id}
                          className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                          title={
                            store.is_active ? "Deactivate" : "Activate"
                          }
                        >
                          {togglingId === store.id ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : store.is_active ? (
                            <ToggleRight
                              size={14}
                              className="text-green-400"
                            />
                          ) : (
                            <ToggleLeft size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(store.id)}
                          disabled={deletingId === store.id}
                          className="p-1.5 text-gray-400 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === store.id ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add / Edit Form */}
        {(showAdd || editingId) && (
          <div className="mt-4 bg-gray-700/30 border border-gray-600/50 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">
                {editingId ? "Edit Store" : "Add New Store"}
              </h3>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Store Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="My Store"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Store URL
              </label>
              <input
                type="text"
                value={form.store_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, store_url: e.target.value }))
                }
                placeholder="my-store.myshopify.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                API Token
              </label>
              <input
                type="password"
                value={form.api_token}
                onChange={(e) =>
                  setForm((f) => ({ ...f, api_token: e.target.value }))
                }
                placeholder="shpat_xxxxx..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  testResult.ok
                    ? "bg-green-900/30 border border-green-700/50 text-green-300"
                    : "bg-red-900/30 border border-red-700/50 text-red-300"
                }`}
              >
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testLoading}
                className="flex-1 flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw
                  size={14}
                  className={testLoading ? "animate-spin" : ""}
                />
                {testLoading ? "Testing..." : "Test Connection"}
              </button>
              <button
                type="button"
                onClick={editingId ? handleUpdate : handleAdd}
                disabled={isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isPending
                  ? "Saving..."
                  : editingId
                    ? "Update Store"
                    : "Save Store"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
