"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import {
  BRAND_FILE_CATEGORIES,
  BRAND_FILE_CATEGORY_LABELS,
  type BrandFileCategory,
  type BrandReferenceFile,
} from "@/lib/ai/brand-types";

interface Props {
  storeName: string;
}

const ACCEPTED_EXTENSIONS = ".txt,.md,.markdown,.docx,.pdf";

export function BrandFilesPanel({ storeName }: Props) {
  const [files, setFiles] = useState<BrandReferenceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<BrandFileCategory>(
    "winning_scripts"
  );
  const [openCategories, setOpenCategories] = useState<Set<BrandFileCategory>>(
    new Set(BRAND_FILE_CATEGORIES)
  );
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!storeName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai/brand-files?store=${encodeURIComponent(storeName)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load files");
      setFiles(json.files ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [storeName]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      if (arr.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of arr) {
          const form = new FormData();
          form.append("file", file);
          form.append("store_name", storeName);
          form.append("category", pendingCategory);
          form.append("title", file.name.replace(/\.[^.]+$/, ""));
          const res = await fetch("/api/ai/brand-files/upload", {
            method: "POST",
            body: form,
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.error || `Upload failed for ${file.name}`);
          }
        }
        await loadFiles();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [storeName, pendingCategory, loadFiles]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this reference file?")) return;
      try {
        const res = await fetch(`/api/ai/brand-files/${id}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Delete failed");
        setFiles((prev) => prev.filter((f) => f.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    []
  );

  const toggleCategory = (cat: BrandFileCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl flex flex-col overflow-hidden h-full">
      <div className="p-3 border-b border-gray-700/50">
        <p className="text-xs font-medium text-gray-400 uppercase mb-2">
          Reference Files
        </p>
        <select
          value={pendingCategory}
          onChange={(e) =>
            setPendingCategory(e.target.value as BrandFileCategory)
          }
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
        >
          {BRAND_FILE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BRAND_FILE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files.length > 0) {
              uploadFiles(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
            dragActive
              ? "border-emerald-500 bg-emerald-500/10"
              : "border-gray-700 hover:border-gray-600 hover:bg-gray-900/30"
          }`}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <RefreshCw size={12} className="animate-spin" />
              Uploading...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 text-gray-500">
              <Upload size={16} />
              <p className="text-xs">Drop files or click</p>
              <p className="text-[10px] text-gray-600">
                .txt .md .docx .pdf
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-[11px] flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <RefreshCw size={14} className="animate-spin text-gray-500" />
          </div>
        )}
        {!loading && files.length === 0 && (
          <p className="text-[11px] text-gray-500 text-center py-4">
            No files yet — upload to give the AI context about this brand.
          </p>
        )}
        {!loading &&
          BRAND_FILE_CATEGORIES.map((cat) => {
            const items = files.filter((f) => f.category === cat);
            if (items.length === 0) return null;
            const open = openCategories.has(cat);
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-1 text-[11px] text-gray-400 hover:text-white uppercase font-medium px-2 py-1 cursor-pointer"
                >
                  {open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {BRAND_FILE_CATEGORY_LABELS[cat]}
                  <span className="ml-auto text-gray-600">{items.length}</span>
                </button>
                {open && (
                  <div className="space-y-0.5 mt-0.5">
                    {items.map((f) => (
                      <div
                        key={f.id}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-700/40 text-xs text-gray-300"
                      >
                        <FileText size={12} className="text-gray-500 flex-shrink-0" />
                        <span className="flex-1 truncate" title={f.title}>
                          {f.title}
                        </span>
                        <button
                          onClick={() => handleDelete(f.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 cursor-pointer transition-opacity"
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
