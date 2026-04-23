"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Check,
  Film,
  Image as ImageIcon,
  Package,
} from "lucide-react";
import type { ApprovedScript } from "@/lib/ai/approved-scripts-types";
import type { ApprovedScriptCreative } from "@/lib/ai/approved-script-creatives-types";

// The picker shows one row per creative (not per script). The user can
// multi-select creatives across scripts — each pick becomes its own Bulk
// Create row with the creative already attached + source_script_id linked.

export interface PickedCreative {
  script: ApprovedScript;
  creative: ApprovedScriptCreative;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPickMany: (picked: PickedCreative[]) => void;
  // Snaps the store filter to this store on open. User can still flip.
  defaultStoreFilter?: string | null;
  // Only show creatives uploaded for this ad account. Keeps image_hash /
  // video_id valid for the wizard's selected account.
  requireAdAccountId?: string | null;
}

type ScriptWithCreatives = ApprovedScript & {
  approved_script_creatives: ApprovedScriptCreative[];
};

export function CreativePickerModal({
  open,
  onClose,
  onPickMany,
  defaultStoreFilter,
  requireAdAccountId,
}: Props) {
  const [scripts, setScripts] = useState<ScriptWithCreatives[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(
    new Set()
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/ai/approved-scripts?include=creatives"
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      const list: ScriptWithCreatives[] = (json.scripts || []).filter(
        (s: ApprovedScript) => s.status !== "archived"
      );
      setScripts(list);
      setStores(
        Array.from(new Set(list.map((s) => s.store_name))).sort()
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setSelectedCreativeIds(new Set());
      setStoreFilter(defaultStoreFilter || "all");
    }
  }, [open, load, defaultStoreFilter]);

  // Only show scripts that (a) pass store filter, (b) have creatives that
  // match the ad account (when a wizard account is required), and (c) match
  // the search string.
  const filteredScripts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scripts
      .map((s) => {
        const eligibleCreatives = (s.approved_script_creatives || []).filter(
          (c) => !requireAdAccountId || c.fb_ad_account_id === requireAdAccountId
        );
        return { ...s, approved_script_creatives: eligibleCreatives };
      })
      .filter((s) => {
        if (s.approved_script_creatives.length === 0) return false;
        if (storeFilter !== "all" && s.store_name !== storeFilter) return false;
        if (q) {
          const hay = `${s.angle_title} ${s.hook} ${s.avatar ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [scripts, storeFilter, search, requireAdAccountId]);

  const toggleCreative = useCallback((creativeId: string) => {
    setSelectedCreativeIds((prev) => {
      const next = new Set(prev);
      if (next.has(creativeId)) next.delete(creativeId);
      else next.add(creativeId);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const picked: PickedCreative[] = [];
    for (const s of scripts) {
      for (const c of s.approved_script_creatives || []) {
        if (selectedCreativeIds.has(c.id)) {
          picked.push({ script: s, creative: c });
        }
      }
    }
    onPickMany(picked);
    onClose();
  }, [scripts, selectedCreativeIds, onPickMany, onClose]);

  if (!open) return null;

  const totalCreatives = filteredScripts.reduce(
    (n, s) => n + s.approved_script_creatives.length,
    0
  );
  const scriptsWithoutCreatives = scripts.filter(
    (s) => (s.approved_script_creatives || []).length === 0
  ).length;

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
              Import from Approved Library
            </h2>
            {selectedCreativeIds.size > 0 && (
              <span className="text-xs text-emerald-400 font-medium">
                {selectedCreativeIds.size} selected
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

        <div className="px-6 py-2 text-[11px] text-gray-500 border-b border-gray-800">
          Pick creatives — each checked thumbnail becomes one ready-to-launch
          row. Primary text / headline / description stay empty (use presets).
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
              placeholder="Search angle, hook..."
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
          ) : totalCreatives === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              <Package size={32} className="mx-auto mb-3 text-gray-700" />
              {scripts.length === 0
                ? "No approved scripts yet."
                : scriptsWithoutCreatives > 0
                ? "No scripts with creatives uploaded yet. Open a script in Approved Library and upload the final video/image first."
                : "No creatives match your filters."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredScripts.map((script) => (
                <div
                  key={script.id}
                  className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {script.angle_title}
                      </h3>
                      <p className="text-[11px] text-gray-500 truncate">
                        {script.store_name} · {script.status.replace("_", " ")}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {script.approved_script_creatives.map((c) => {
                      const selected = selectedCreativeIds.has(c.id);
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => toggleCreative(c.id)}
                            className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors cursor-pointer text-left ${
                              selected
                                ? "bg-emerald-900/30 border-emerald-600/60"
                                : "bg-gray-900/50 border-gray-700/50 hover:border-emerald-700/50"
                            }`}
                          >
                            <div
                              className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                                selected
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "border-gray-600"
                              }`}
                            >
                              {selected && (
                                <Check size={11} className="text-white" />
                              )}
                            </div>
                            <div className="flex-shrink-0 w-7 h-7 rounded bg-gray-900 border border-gray-700 flex items-center justify-center text-gray-400">
                              {c.creative_type === "video" ? (
                                <Film size={13} />
                              ) : (
                                <ImageIcon size={13} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-white truncate">
                                {c.file_name ||
                                  c.label ||
                                  c.fb_video_id ||
                                  c.fb_image_hash}
                              </p>
                              <p className="text-[10px] text-gray-500 truncate">
                                {c.creative_type.toUpperCase()} ·{" "}
                                {new Date(c.uploaded_at).toLocaleDateString(
                                  "en-US",
                                  { month: "short", day: "numeric" }
                                )}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {selectedCreativeIds.size === 0
              ? "Pick one or more creatives"
              : `${selectedCreativeIds.size} creative${selectedCreativeIds.size === 1 ? "" : "s"} → ${selectedCreativeIds.size} row${selectedCreativeIds.size === 1 ? "" : "s"}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-white px-3 py-2 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCreativeIds.size === 0}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add rows
              {selectedCreativeIds.size > 0 && ` (${selectedCreativeIds.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
