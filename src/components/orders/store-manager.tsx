"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  Store,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  CheckCircle,
  ExternalLink,
  X,
  AlertCircle,
} from "lucide-react";
import type { ShopifyStore } from "@/lib/shopify/types";
import {
  addShopifyStore,
  updateShopifyStore,
  deleteShopifyStore,
  toggleShopifyStore,
} from "@/lib/shopify/actions";

interface Props {
  stores: ShopifyStore[];
}

interface FormState {
  name: string;
  store_url: string;
  client_id: string;
  client_secret: string;
}

const emptyForm: FormState = {
  name: "",
  store_url: "",
  client_id: "",
  client_secret: "",
};

export function StoreManager({ stores: initialStores }: Props) {
  const searchParams = useSearchParams();
  const shopifyError = searchParams.get("shopify_error");
  const shopifySuccess = searchParams.get("shopify_success");

  const [stores, setStores] = useState<ShopifyStore[]>(initialStores);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(shopifyError);
  const [success, setSuccess] = useState<string | null>(shopifySuccess);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const resetForm = () => {
    setForm(emptyForm);
    setShowAdd(false);
    setEditingId(null);
    setError(null);
  };

  const showSuccessMsg = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleAdd = () => {
    setError(null);
    const formData = new FormData();
    formData.set("name", form.name);
    formData.set("store_url", form.store_url);
    formData.set("client_id", form.client_id);
    formData.set("client_secret", form.client_secret);

    startTransition(async () => {
      const result = await addShopifyStore(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.store_id) {
        // Redirect to Shopify OAuth to get the token
        window.location.href = `/api/shopify/auth?store_id=${result.store_id}`;
      }
    });
  };

  const handleUpdate = () => {
    if (!editingId) return;
    setError(null);
    const formData = new FormData();
    formData.set("name", form.name);
    formData.set("store_url", form.store_url);
    formData.set("client_id", form.client_id);
    formData.set("client_secret", form.client_secret);

    startTransition(async () => {
      const result = await updateShopifyStore(editingId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        showSuccessMsg("Store updated");
        window.location.reload();
      }
    });
  };

  const handleReconnect = (storeId: string) => {
    window.location.href = `/api/shopify/auth?store_id=${storeId}`;
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
        showSuccessMsg("Store deleted");
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
        showSuccessMsg(`Store ${!currentActive ? "activated" : "deactivated"}`);
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
      client_id: store.client_id || "",
      client_secret: "",
    });
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
                Connect your Shopify stores via OAuth
              </p>
            </div>
          </div>
          {!showAdd && !editingId && (
            <button
              onClick={() => {
                setShowAdd(true);
                setForm(emptyForm);
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
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
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
                      {store.api_token ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          store.is_active
                            ? "bg-green-900/30 text-green-400"
                            : "bg-gray-700/50 text-gray-400"
                        }`}>
                          {store.is_active ? "Connected" : "Inactive"}
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400">
                          Not connected
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {!store.api_token && (
                          <button
                            onClick={() => handleReconnect(store.id)}
                            className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded transition-colors cursor-pointer"
                            title="Connect to Shopify"
                          >
                            <ExternalLink size={12} />
                            Connect
                          </button>
                        )}
                        {store.api_token && (
                          <button
                            onClick={() => handleReconnect(store.id)}
                            className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                            title="Reconnect"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(store)}
                          className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleToggle(store.id, store.is_active)}
                          disabled={togglingId === store.id}
                          className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                          title={store.is_active ? "Deactivate" : "Activate"}
                        >
                          {togglingId === store.id ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : store.is_active ? (
                            <ToggleRight size={14} className="text-green-400" />
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
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="I Love Patches"
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
                onChange={(e) => setForm((f) => ({ ...f, store_url: e.target.value }))}
                placeholder="ilovepatches.myshopify.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Client ID
                <span className="text-gray-500 ml-1">(from Shopify Dev Dashboard → App → Settings)</span>
              </label>
              <input
                type="text"
                value={form.client_id}
                onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                placeholder="5db6a43ec3a87588310cd8b1a8630343"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Client Secret
                <span className="text-gray-500 ml-1">(starts with shpss_)</span>
              </label>
              <input
                type="password"
                value={form.client_secret}
                onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))}
                placeholder="shpss_xxxxx..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <p className="text-xs text-gray-500">
              After saving, you&apos;ll be redirected to Shopify to approve the connection.
              Make sure your Shopify app has this redirect URL configured:
              <br />
              <code className="text-gray-400">
                {typeof window !== "undefined" ? window.location.origin : "https://your-domain.vercel.app"}
                /api/shopify/auth/callback
              </code>
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={editingId ? handleUpdate : handleAdd}
                disabled={isPending || !form.name || !form.store_url || !form.client_id || !form.client_secret}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    {editingId ? "Updating..." : "Saving & connecting..."}
                  </>
                ) : editingId ? (
                  "Update Store"
                ) : (
                  <>
                    <ExternalLink size={14} />
                    Save & Connect to Shopify
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
