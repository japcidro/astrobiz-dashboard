"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Check,
} from "lucide-react";
import type { ApprovedScript } from "@/lib/ai/approved-scripts-types";
import { ANGLE_TYPE_LABELS } from "@/lib/ai/approved-scripts-types";

interface SingleProps {
  open: boolean;
  onClose: () => void;
  mode?: "single";
  onPick: (script: ApprovedScript) => void;
  // If set, the store filter snaps to this store name when the modal opens.
  // User can still switch to "All stores". Prevents accidentally attaching
  // a script from the wrong store to an ad.
  defaultStoreFilter?: string | null;
}

interface MultiProps {
  open: boolean;
  onClose: () => void;
  mode: "multi";
  onPickMany: (scripts: ApprovedScript[]) => void;
  confirmLabel?: string;
  defaultStoreFilter?: string | null;
}

type Props = SingleProps | MultiProps;

const ANGLE_TYPE_COLORS: Record<string, string> = {
  D: "bg-pink-900/30 text-pink-300 border-pink-700/50",
  E: "bg-blue-900/30 text-blue-300 border-blue-700/50",
  M: "bg-purple-900/30 text-purple-300 border-purple-700/50",
  B: "bg-amber-900/30 text-amber-300 border-amber-700/50",
};

export function ScriptPickerModal(props: Props) {
  const { open, onClose, defaultStoreFilter } = props;
  const isMulti = props.mode === "multi";

  const [scripts, setScripts] = useState<ApprovedScript[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Library shows approved + in_production + shot + live (everything except
  // archived). Marketer picks whatever they're about to shoot / is running.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/approved-scripts");
      const json = await res.json();
      const list: ApprovedScript[] = (json.scripts || []).filter(
        (s: ApprovedScript) => s.status !== "archived"
      );
      setScripts(list);
      setStores(Array.from(new Set(list.map((s) => s.store_name))).sort());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scripts.filter((s) => {
      if (storeFilter !== "all" && s.store_name !== storeFilter) return false;
      if (q) {
        const hay = `${s.angle_title} ${s.hook} ${s.body_script} ${s.avatar ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scripts, storeFilter, search]);

  // Clear selection when modal reopens so stale selections don't stick.
  // Also snap the store filter to the wizard's selected store, if any —
  // prevents cross-store mix-ups. User can still flip to "All stores".
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setStoreFilter(defaultStoreFilter || "all");
    }
  }, [open, defaultStoreFilter]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirmMulti = useCallback(() => {
    if (!isMulti) return;
    const picked = scripts.filter((s) => selectedIds.has(s.id));
    (props as MultiProps).onPickMany(picked);
    onClose();
  }, [isMulti, scripts, selectedIds, props, onClose]);

  if (!open) return null;

  const confirmLabel = isMulti
    ? ((props as MultiProps).confirmLabel ?? "Add rows")
    : "";

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-emerald-400" />
            <h2 className="text-lg font-bold text-white">
              {isMulti ? "Pick scripts" : "Pick a script"}
            </h2>
            {isMulti && selectedIds.size > 0 && (
              <span className="text-xs text-emerald-400 font-medium">
                {selectedIds.size} selected
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search angle, hook, body..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All stores</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} className="animate-spin text-gray-500" />
            </div>
          ) : error ? (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              {scripts.length === 0
                ? "No approved scripts yet. Approve scripts from the AI Generator → Chat tab."
                : "No scripts match your filters."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((script) => {
                const selected = selectedIds.has(script.id);
                const handleClick = () => {
                  if (isMulti) {
                    toggleSelected(script.id);
                  } else {
                    (props as SingleProps).onPick(script);
                    onClose();
                  }
                };
                return (
                  <button
                    key={script.id}
                    onClick={handleClick}
                    className={`w-full text-left border rounded-lg p-3 transition-colors cursor-pointer ${
                      selected
                        ? "bg-emerald-900/20 border-emerald-700/50"
                        : "bg-gray-800/50 hover:bg-gray-800 border-gray-700/50 hover:border-emerald-700/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {isMulti && (
                        <div
                          className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center ${
                            selected
                              ? "bg-emerald-500 border-emerald-500"
                              : "border-gray-600"
                          }`}
                        >
                          {selected && (
                            <Check size={12} className="text-white" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="text-sm font-semibold text-white truncate">
                            {script.angle_title}
                          </h3>
                          <span className="flex-shrink-0 text-[10px] text-gray-500">
                            {script.store_name}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 line-clamp-2 mb-1.5">
                          {script.hook}
                        </p>
                        <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-gray-500">
                          {script.avatar && <span>{script.avatar}</span>}
                          {script.angle_type && (
                            <span
                              className={`px-1.5 py-0.5 rounded border font-medium ${ANGLE_TYPE_COLORS[script.angle_type]}`}
                            >
                              {script.angle_type} —{" "}
                              {ANGLE_TYPE_LABELS[script.angle_type]}
                            </span>
                          )}
                          {script.intensity !== null && (
                            <span>Int {script.intensity}</span>
                          )}
                          {script.capacity !== null && (
                            <span>Cap {script.capacity}</span>
                          )}
                          <span className="ml-auto">
                            Status: {script.status.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer — multi-select confirm */}
        {isMulti && (
          <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              {selectedIds.size === 0
                ? "Pick one or more scripts"
                : `${selectedIds.size} script${selectedIds.size === 1 ? "" : "s"} selected`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-sm text-gray-400 hover:text-white px-3 py-2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMulti}
                disabled={selectedIds.size === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {confirmLabel}
                {selectedIds.size > 0 && ` (${selectedIds.size})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
