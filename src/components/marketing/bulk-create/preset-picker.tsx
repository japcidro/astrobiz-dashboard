"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookMarked, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  AD_COPY_PRESET_KIND_LABELS,
  type AdCopyPreset,
  type AdCopyPresetKind,
} from "@/lib/ad-copy-presets/types";

// Module-level cache so opening the picker on any row doesn't refetch.
// Keyed by `${storeId}:${kind}`. Invalidated on create/delete.
const presetCache = new Map<string, AdCopyPreset[]>();
const inflight = new Map<string, Promise<AdCopyPreset[]>>();

function cacheKey(storeId: string, kind: AdCopyPresetKind) {
  return `${storeId}:${kind}`;
}

async function fetchPresets(
  storeId: string,
  kind: AdCopyPresetKind
): Promise<AdCopyPreset[]> {
  const key = cacheKey(storeId, kind);
  const cached = presetCache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const res = await fetch(
      `/api/ad-copy-presets?store_id=${encodeURIComponent(storeId)}&kind=${kind}`
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load presets");
    const list = (json.presets || []) as AdCopyPreset[];
    presetCache.set(key, list);
    return list;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

function invalidate(storeId: string, kind: AdCopyPresetKind) {
  presetCache.delete(cacheKey(storeId, kind));
}

interface Props {
  kind: AdCopyPresetKind;
  storeId: string | null;
  currentValue: string;
  onApply: (content: string) => void;
}

export function PresetPicker({ kind, storeId, currentValue, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<AdCopyPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);

  const kindLabel = AD_COPY_PRESET_KIND_LABELS[kind];

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPresets(storeId, kind);
      setPresets(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [storeId, kind]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSaveMode(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleApply = (content: string) => {
    onApply(content);
    setOpen(false);
    setSaveMode(false);
  };

  const handleSave = async () => {
    if (!storeId) return;
    const label = newLabel.trim();
    if (!label) {
      setError("Label required");
      return;
    }
    if (!currentValue.trim()) {
      setError("Current value is empty — nothing to save");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ad-copy-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopify_store_id: storeId,
          kind,
          label,
          content: currentValue,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      invalidate(storeId, kind);
      await load();
      setSaveMode(false);
      setNewLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!storeId) return;
    setError(null);
    try {
      const res = await fetch(`/api/ad-copy-presets/${id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete");
      invalidate(storeId, kind);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const disabled = !storeId;
  const titleAttr = useMemo(
    () =>
      disabled
        ? "Select a store (Section A) to use presets"
        : `${kindLabel} presets`,
    [disabled, kindLabel]
  );

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={titleAttr}
        className={`inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 transition-colors ${
          disabled
            ? "text-gray-600 cursor-not-allowed"
            : "text-gray-400 hover:text-emerald-300 hover:bg-gray-700 cursor-pointer"
        }`}
      >
        <BookMarked size={10} />
        Preset
      </button>

      {open && !disabled && (
        <div className="absolute z-20 top-full right-0 mt-1 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
            <p className="text-[11px] font-semibold text-gray-300">
              {kindLabel} presets
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSaveMode(false);
              }}
              className="text-gray-500 hover:text-white cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-gray-500">
                <Loader2 size={14} className="animate-spin" />
              </div>
            ) : presets.length === 0 ? (
              <p className="text-center text-[11px] text-gray-500 py-4 px-3">
                No presets yet. Save one below.
              </p>
            ) : (
              <ul className="py-1">
                {presets.map((p) => (
                  <li key={p.id} className="group">
                    <div className="flex items-start gap-1 px-2 py-1.5 hover:bg-gray-800/80">
                      <button
                        type="button"
                        onClick={() => handleApply(p.content)}
                        className="flex-1 text-left min-w-0 cursor-pointer"
                      >
                        <p className="text-[11px] font-medium text-white truncate">
                          {p.label}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {p.content}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        title="Delete preset"
                        className="flex-shrink-0 p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="px-3 py-1.5 text-[10px] text-red-400 border-t border-gray-800">
              {error}
            </p>
          )}

          <div className="border-t border-gray-800 p-2">
            {saveMode ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Preset name (e.g. Default offer)"
                  className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSave();
                    }
                    if (e.key === "Escape") {
                      setSaveMode(false);
                      setNewLabel("");
                    }
                  }}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !newLabel.trim()}
                    className="flex-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] px-2 py-1 cursor-pointer"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMode(false);
                      setNewLabel("");
                      setError(null);
                    }}
                    className="rounded text-gray-400 hover:text-white text-[11px] px-2 py-1 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[9px] text-gray-500">
                  Saves the current field text as a reusable preset.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSaveMode(true);
                  setError(null);
                }}
                disabled={!currentValue.trim()}
                title={
                  !currentValue.trim()
                    ? "Type something in the field first, then save it as a preset"
                    : "Save the current field text as a preset"
                }
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-400 hover:text-emerald-300 hover:bg-gray-800/80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Plus size={11} />
                Save current as preset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
