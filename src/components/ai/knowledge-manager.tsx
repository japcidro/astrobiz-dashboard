"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  X,
  Upload,
} from "lucide-react";
import { DOC_TYPES, SYSTEM_PROMPT_TYPES, type AiStoreDoc, type DocType } from "@/lib/ai/types";

interface StoreOption {
  name: string;
}

export function KnowledgeManager() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [docs, setDocs] = useState<AiStoreDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit/Add state
  const [editingDocType, setEditingDocType] = useState<DocType | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  // Fetch stores on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/shopify/stores");
        const data = await res.json();
        const storeList: StoreOption[] = (data.stores || data || []).map(
          (s: { name: string }) => ({ name: s.name })
        );
        setStores(storeList);
        if (storeList.length > 0 && !selectedStore) {
          setSelectedStore(storeList[0].name);
        }
      } catch {
        setError("Failed to load stores");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch docs when store changes
  const fetchDocs = useCallback(async (storeName: string) => {
    if (!storeName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai/docs?store=${encodeURIComponent(storeName)}`
      );
      const data = await res.json();
      setDocs(data.docs || data || []);
    } catch {
      setError("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStore) {
      fetchDocs(selectedStore);
    }
  }, [selectedStore, fetchDocs]);

  const getDocForType = (key: string): AiStoreDoc | undefined =>
    docs.find((d) => d.doc_type === key);

  const allTypes = [...DOC_TYPES, ...SYSTEM_PROMPT_TYPES];
  const totalRequired = allTypes.length; // 6 docs + 3 system prompts = 9
  const filledCount = allTypes.filter((dt) => getDocForType(dt.key)).length;

  const startEdit = (docType: DocType, existing?: AiStoreDoc) => {
    setEditingDocType(docType);
    const label = DOC_TYPES.find((d) => d.key === docType)?.label || docType;
    setEditTitle(existing?.title || label);
    setEditContent(existing?.content || "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingDocType(null);
    setEditTitle("");
    setEditContent("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditContent((ev.target?.result as string) || "");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSave = async () => {
    if (!editingDocType || !selectedStore) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: selectedStore,
          doc_type: editingDocType,
          title: editTitle,
          content: editContent,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      cancelEdit();
      setSuccess("Document saved");
      setTimeout(() => setSuccess(null), 3000);
      fetchDocs(selectedStore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (doc: AiStoreDoc) => {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    setDeleting(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/ai/docs?id=${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      setSuccess("Document deleted");
      setTimeout(() => setSuccess(null), 3000);
      fetchDocs(selectedStore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-emerald-600/20 rounded-lg">
            <BookOpen size={20} className="text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              Knowledge Documents
            </h2>
            <p className="text-sm text-gray-400">
              Manage per-store AI knowledge documents
            </p>
          </div>
        </div>

        {/* Store Selector */}
        <div className="mb-6">
          <label className="block text-sm text-gray-300 mb-1.5">Store</label>
          <select
            value={selectedStore}
            onChange={(e) => {
              setSelectedStore(e.target.value);
              cancelEdit();
            }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {stores.length === 0 && (
              <option value="">No stores available</option>
            )}
            {stores.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Progress */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex-1 bg-gray-700/50 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{ width: `${(filledCount / totalRequired) * 100}%` }}
            />
          </div>
          <span className="text-sm text-gray-300 whitespace-nowrap">
            {filledCount}/{totalRequired} documents ready
          </span>
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

        {/* Document Slots */}
        {loading ? (
          <div className="py-8 text-center text-gray-500 text-sm flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-gray-500 font-medium pt-2 pb-1">Knowledge Documents</p>
            {DOC_TYPES.map((dt) => {
              const existing = getDocForType(dt.key);
              const isEditing = editingDocType === dt.key;

              return (
                <div key={dt.key}>
                  {/* Row */}
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                      isEditing
                        ? "bg-emerald-900/20 border border-emerald-700/50"
                        : "bg-gray-700/30 border border-transparent hover:bg-gray-700/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {dt.label}
                      </p>
                      {existing ? (
                        <p className="text-xs text-green-400 mt-0.5">
                          {existing.content.length.toLocaleString()} chars
                        </p>
                      ) : (
                        <p className="text-xs text-red-400 mt-0.5">Not set</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      {existing ? (
                        <>
                          <button
                            onClick={() => startEdit(dt.key, existing)}
                            className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-white text-xs transition-colors cursor-pointer"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(existing)}
                            disabled={deleting === existing.id}
                            className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-red-400 text-xs transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {deleting === existing.id ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                            Delete
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(dt.key)}
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded transition-colors cursor-pointer"
                        >
                          <Plus size={12} />
                          Add
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline Edit Section */}
                  {isEditing && (
                    <div className="mt-2 mb-3 bg-gray-700/30 border border-gray-600/50 rounded-lg p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-white">
                          {existing ? "Edit" : "Add"} {dt.label}
                        </h3>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-white cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-300 mb-1.5">
                          Title
                        </label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-300 mb-1.5">
                          Content
                        </label>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={10}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                          placeholder="Paste or type your document content..."
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors cursor-pointer">
                          <Upload size={12} />
                          Upload .txt
                          <input
                            type="file"
                            accept=".txt"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                        <span className="text-xs text-gray-500">
                          {editContent.length.toLocaleString()} chars
                        </span>
                      </div>

                      <button
                        onClick={handleSave}
                        disabled={saving || !editTitle || !editContent}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {saving ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Document"
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-xs uppercase tracking-wider text-gray-500 font-medium pt-6 pb-1">System Instructions (per tool)</p>
            {SYSTEM_PROMPT_TYPES.map((dt) => {
              const existing = getDocForType(dt.key);
              const isEditing = editingDocType === dt.key;

              return (
                <div
                  key={dt.key}
                  className="bg-gray-700/20 border border-gray-700/50 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{dt.label}</p>
                      {existing ? (
                        <p className="text-xs text-green-400">{existing.content.length.toLocaleString()} chars</p>
                      ) : (
                        <p className="text-xs text-red-400">Not set</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {existing ? (
                        <>
                          <button onClick={() => startEdit(dt.key, existing)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"><Pencil size={12} /> Edit</button>
                          <button onClick={() => handleDelete(existing)} className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1 cursor-pointer"><Trash2 size={12} /> Delete</button>
                        </>
                      ) : (
                        <button onClick={() => startEdit(dt.key)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded flex items-center gap-1 cursor-pointer"><Plus size={12} /> Add</button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={12}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y font-mono"
                        placeholder="Paste your system instruction here..."
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingDocType(null)} className="px-3 py-1.5 text-gray-400 text-sm cursor-pointer">Cancel</button>
                        <button
                          onClick={handleSave}
                          disabled={saving || !editContent}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
