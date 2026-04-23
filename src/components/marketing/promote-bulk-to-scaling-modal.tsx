"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  TrendingUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  XCircle,
} from "lucide-react";

export interface BulkPromoteSubject {
  ad_id: string;
  ad_name: string;
  // Source adset name — reused as the new scaling adset name when
  // cloning per ad, so scaling traceability mirrors the testing adset.
  adset_name: string;
  thumbnail_url?: string | null;
}

interface Props {
  subjects: BulkPromoteSubject[];
  // Parent campaign name for all subjects (adset drill is single-campaign
  // scoped). Used to auto-derive the target store.
  campaign_name: string | null;
  onClose: () => void;
  onComplete: (result: {
    succeeded: number;
    failed: number;
  }) => void;
}

interface Adset {
  id: string;
  name: string;
  effective_status: string;
}

interface StoreConfig {
  store_name: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
}

type RowStatus = "idle" | "copying" | "success" | "failed";

interface RowResult {
  status: RowStatus;
  error?: string;
  copied_ad_id?: string | null;
}

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deriveStoreFromCampaign(
  campaign: string | null | undefined,
  stores: string[]
): string | null {
  const nc = normalize(campaign ?? "");
  if (!nc) return null;
  let best: { name: string; len: number } | null = null;
  for (const s of stores) {
    const k = normalize(s);
    if (k && nc.includes(k) && (!best || k.length > best.len)) {
      best = { name: s, len: k.length };
    }
  }
  return best?.name ?? null;
}

export function PromoteBulkToScalingModal({
  subjects,
  campaign_name,
  onClose,
  onComplete,
}: Props) {
  const [configs, setConfigs] = useState<StoreConfig[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [selectedStore, setSelectedStore] = useState<string>("");
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string>("");
  const [templateAdsetId, setTemplateAdsetId] = useState<string>("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [statusOption, setStatusOption] = useState<"PAUSED" | "ACTIVE">(
    "PAUSED"
  );

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, RowResult>>(new Map());

  const loadConfigs = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/marketing/scaling/config");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load scaling mapping");
      }
      const json = (await res.json()) as { rows: StoreConfig[] };
      setConfigs(json.rows ?? []);
      const stores = (json.rows ?? []).map((c) => c.store_name);
      const derived = deriveStoreFromCampaign(campaign_name, stores);
      if (derived && stores.includes(derived)) setSelectedStore(derived);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
  }, [campaign_name]);

  const loadAdsets = useCallback(async (store: string) => {
    setLoadingAdsets(true);
    setAdsets([]);
    setSelectedAdsetId("");
    setTemplateAdsetId("");
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/scaling/adsets?store=${encodeURIComponent(store)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load adsets");
      setAdsets((json.adsets as Adset[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load adsets");
    } finally {
      setLoadingAdsets(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (selectedStore) loadAdsets(selectedStore);
  }, [selectedStore, loadAdsets]);

  const availableStores = useMemo(
    () => configs.map((c) => c.store_name).sort((a, b) => a.localeCompare(b)),
    [configs]
  );

  const canSubmit = (() => {
    if (submitting || done || loadingAdsets || !selectedStore) return false;
    if (subjects.length === 0) return false;
    if (mode === "existing") return !!selectedAdsetId;
    return !!templateAdsetId;
  })();

  const tally = useMemo(() => {
    let succeeded = 0;
    let failed = 0;
    for (const r of results.values()) {
      if (r.status === "success") succeeded++;
      else if (r.status === "failed") failed++;
    }
    return { succeeded, failed };
  }, [results]);

  const updateRow = (adId: string, patch: RowResult) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(adId, patch);
      return next;
    });
  };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setResults(new Map());

    for (const subject of subjects) {
      updateRow(subject.ad_id, { status: "copying" });
      try {
        const payload: Record<string, unknown> = {
          ad_id: subject.ad_id,
          target_store: selectedStore,
          status_option: statusOption,
        };
        if (mode === "existing") {
          payload.target_adset_id = selectedAdsetId;
        } else {
          // Clone the selected template once per ad, naming each new
          // adset after the source adset so scaling rows mirror testing.
          payload.new_adset = {
            template_adset_id: templateAdsetId,
            name: subject.adset_name.trim() || subject.ad_name.trim(),
          };
        }
        const res = await fetch("/api/marketing/scaling/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) {
          updateRow(subject.ad_id, {
            status: "failed",
            error: json.error || `Promote failed (${res.status})`,
          });
        } else {
          updateRow(subject.ad_id, {
            status: "success",
            copied_ad_id: json.copied_ad_id ?? null,
          });
        }
      } catch (e) {
        updateRow(subject.ad_id, {
          status: "failed",
          error: e instanceof Error ? e.message : "Promote failed",
        });
      }
    }

    setSubmitting(false);
    setDone(true);
  }

  function handleClose() {
    if (submitting) return;
    if (done) {
      onComplete({
        succeeded: tally.succeeded,
        failed: tally.failed,
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-orange-600/20 rounded-lg flex-shrink-0">
              <TrendingUp size={18} className="text-orange-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">
                Promote {subjects.length}{" "}
                {subjects.length === 1 ? "ad" : "ads"} to scaling
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                Copies each ad into the scaling campaign. One API call per ad.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-gray-400 hover:text-white p-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Subject list */}
          <div className="max-h-48 overflow-y-auto bg-gray-800/40 border border-gray-700/50 rounded-lg divide-y divide-gray-700/40">
            {subjects.map((s) => {
              const r = results.get(s.ad_id);
              return (
                <div
                  key={s.ad_id}
                  className="flex items-center gap-3 p-2"
                >
                  {s.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.thumbnail_url}
                      alt=""
                      className="w-10 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 aspect-video bg-gray-800 rounded border border-gray-700 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white font-medium truncate">
                      {s.ad_name}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      from {s.adset_name}
                    </p>
                  </div>
                  <div className="flex-shrink-0 w-24 text-right">
                    {!r || r.status === "idle" ? (
                      <Circle size={14} className="text-gray-600 inline" />
                    ) : r.status === "copying" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-300">
                        <Loader2 size={12} className="animate-spin" />
                        Copying…
                      </span>
                    ) : r.status === "success" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <CheckCircle2 size={12} />
                        Done
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-red-400"
                        title={r.error}
                      >
                        <XCircle size={12} />
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Target store */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Target store
            </label>
            {loadingConfig ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <Loader2 size={12} className="animate-spin" />
                Loading configured stores…
              </div>
            ) : availableStores.length === 0 ? (
              <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                No scaling campaigns mapped. Go to Admin → Settings → Scaling
                Campaigns to configure first.
              </div>
            ) : (
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                disabled={submitting || done}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">— Pick store —</option>
                {availableStores.map((s) => {
                  const cfg = configs.find((c) => c.store_name === s);
                  return (
                    <option key={s} value={s}>
                      {s} → {cfg?.campaign_name ?? ""}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Mode */}
          {selectedStore && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("new")}
                disabled={submitting || done}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  mode === "new"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Clone per ad (recommended)
              </button>
              <button
                type="button"
                onClick={() => setMode("existing")}
                disabled={submitting || done}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  mode === "existing"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Drop all into one adset
              </button>
            </div>
          )}

          {/* Clone-per-ad */}
          {selectedStore && mode === "new" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Template adset (targeting + budget cloned per ad)
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading adsets from scaling campaign…
                </div>
              ) : adsets.length === 0 ? (
                <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  No adsets in scaling campaign yet. Create one in Ads
                  Manager first — we clone it per ad.
                </div>
              ) : (
                <>
                  <select
                    value={templateAdsetId}
                    onChange={(e) => setTemplateAdsetId(e.target.value)}
                    disabled={submitting || done}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">— Pick template adset —</option>
                    {adsets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.effective_status === "PAUSED" ? " (paused)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Each new adset is named after its source adset. New adsets
                    always start PAUSED.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Existing adset */}
          {selectedStore && mode === "existing" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Target adset — all {subjects.length} ads land here
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading adsets from scaling campaign…
                </div>
              ) : adsets.length === 0 ? (
                <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  No adsets in scaling campaign. Switch to &quot;Clone per
                  ad&quot; to create one from a template.
                </div>
              ) : (
                <select
                  value={selectedAdsetId}
                  onChange={(e) => setSelectedAdsetId(e.target.value)}
                  disabled={submitting || done}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">— Pick adset —</option>
                  {adsets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.effective_status === "PAUSED" ? " (paused)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Status option */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              After copy
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatusOption("PAUSED")}
                disabled={submitting || done}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  statusOption === "PAUSED"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Keep PAUSED (review first)
              </button>
              <button
                type="button"
                onClick={() => setStatusOption("ACTIVE")}
                disabled={submitting || done}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  statusOption === "ACTIVE"
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Activate immediately
              </button>
            </div>
          </div>

          {/* Result tally */}
          {done && (
            <div className="p-2.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-xs text-gray-300">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 size={12} />
                  {tally.succeeded} succeeded
                </span>
                {tally.failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <XCircle size={12} />
                    {tally.failed} failed
                  </span>
                )}
              </div>
              {tally.failed > 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Hover the Failed badge on each row to see the error message.
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {submitting
                ? `Copying ${tally.succeeded + tally.failed + 1}/${subjects.length}…`
                : `Promote ${subjects.length} ${subjects.length === 1 ? "ad" : "ads"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
