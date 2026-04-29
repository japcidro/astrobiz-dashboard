"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  TrendingUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export interface PromoteSubject {
  ad_id: string;
  ad_name: string;
  thumbnail_url?: string | null;
  campaign_name?: string | null;
  // Pre-derived store (from campaign name). Caller usually knows this.
  suggested_store?: string | null;
}

interface Props {
  subject: PromoteSubject;
  onClose: () => void;
  onSuccess: (result: {
    copied_ad_id: string | null;
    status: "PAUSED" | "ACTIVE";
  }) => void;
}

interface Adset {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface StoreConfig {
  store_name: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
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

export function PromoteToScalingModal({
  subject,
  onClose,
  onSuccess,
}: Props) {
  const [configs, setConfigs] = useState<StoreConfig[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [selectedStore, setSelectedStore] = useState<string>(
    subject.suggested_store ?? ""
  );
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string>("");
  const [statusOption, setStatusOption] = useState<"PAUSED" | "ACTIVE">(
    "PAUSED"
  );

  // "Existing" = drop ad into a chosen adset.
  // "New"      = clone a template adset in the scaling campaign, rename it,
  //              then drop the ad in there.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newAdsetName, setNewAdsetName] = useState("");
  const [templateAdsetId, setTemplateAdsetId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fbCode, setFbCode] = useState<number | null>(null);
  const [fbSubcode, setFbSubcode] = useState<number | null>(null);
  const [fbUserMsg, setFbUserMsg] = useState<string | null>(null);
  const [fbTrace, setFbTrace] = useState<string | null>(null);
  const [diag, setDiag] = useState<unknown>(null);
  const [showDiag, setShowDiag] = useState(false);

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

      if (!selectedStore) {
        const stores = (json.rows ?? []).map((c) => c.store_name);
        // Prefer an explicit suggestion; else derive from campaign name.
        let store: string | null = subject.suggested_store ?? null;
        if (!store && subject.campaign_name) {
          store = deriveStoreFromCampaign(subject.campaign_name, stores);
        }
        if (store && stores.includes(store)) setSelectedStore(store);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAdsets = useCallback(async (store: string) => {
    setLoadingAdsets(true);
    setAdsets([]);
    setSelectedAdsetId("");
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
    if (selectedStore) {
      loadAdsets(selectedStore);
    }
  }, [selectedStore, loadAdsets]);

  const availableStores = useMemo(
    () => configs.map((c) => c.store_name).sort((a, b) => a.localeCompare(b)),
    [configs]
  );

  const canSubmit = (() => {
    if (submitting || loadingAdsets || !selectedStore) return false;
    if (mode === "existing") return !!selectedAdsetId;
    return !!templateAdsetId && newAdsetName.trim().length >= 3;
  })();

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setFbCode(null);
    setFbSubcode(null);
    setFbUserMsg(null);
    setFbTrace(null);
    setDiag(null);
    setShowDiag(false);
    try {
      const payload: Record<string, unknown> = {
        ad_id: subject.ad_id,
        target_store: selectedStore,
        status_option: statusOption,
      };
      if (mode === "existing") {
        payload.target_adset_id = selectedAdsetId;
      } else {
        payload.new_adset = {
          template_adset_id: templateAdsetId,
          name: newAdsetName.trim(),
        };
      }
      const res = await fetch("/api/marketing/scaling/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        if (typeof json.fb_code === "number") setFbCode(json.fb_code);
        if (typeof json.fb_subcode === "number") setFbSubcode(json.fb_subcode);
        if (typeof json.fb_user_msg === "string") setFbUserMsg(json.fb_user_msg);
        if (typeof json.fb_trace === "string") setFbTrace(json.fb_trace);
        if (json.diag) setDiag(json.diag);
        throw new Error(json.error || `Promote failed (${res.status})`);
      }
      onSuccess({
        copied_ad_id: json.copied_ad_id ?? null,
        status: statusOption,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    } finally {
      setSubmitting(false);
    }
  }

  const activeAdsetCount = adsets.filter(
    (a) => a.effective_status === "ACTIVE"
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-700">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-orange-600/20 rounded-lg flex-shrink-0">
              <TrendingUp size={18} className="text-orange-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">
                Promote to scaling
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                Duplicates this ad into the scaling campaign&apos;s adset.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Ad preview */}
          <div className="flex items-center gap-3 p-2 bg-gray-800/40 border border-gray-700/50 rounded-lg">
            {subject.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={subject.thumbnail_url}
                alt=""
                className="w-12 aspect-video object-cover rounded border border-gray-700 flex-shrink-0"
              />
            ) : (
              <div className="w-12 aspect-video bg-gray-800 rounded border border-gray-700 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm text-white font-medium truncate">
                {subject.ad_name}
              </p>
              {subject.campaign_name && (
                <p className="text-xs text-gray-500 truncate">
                  {subject.campaign_name}
                </p>
              )}
            </div>
          </div>

          {/* Store picker */}
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
                No scaling campaigns mapped. Go to Admin → Settings →
                Scaling Campaigns to configure first.
              </div>
            ) : (
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                disabled={submitting}
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

          {/* Mode toggle */}
          {selectedStore && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                disabled={submitting}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  mode === "existing"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                Existing adset
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                disabled={submitting}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  mode === "new"
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                + New adset
              </button>
            </div>
          )}

          {/* Existing-adset picker */}
          {selectedStore && mode === "existing" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Target adset{" "}
                {loadingAdsets ? (
                  ""
                ) : (
                  <span className="text-gray-500">
                    ({activeAdsetCount} active of {adsets.length})
                  </span>
                )}
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading adsets from scaling campaign…
                </div>
              ) : adsets.length === 0 ? (
                <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  No adsets in scaling campaign. Switch to &quot;+ New adset&quot;
                  to clone one into place.
                </div>
              ) : (
                <select
                  value={selectedAdsetId}
                  onChange={(e) => setSelectedAdsetId(e.target.value)}
                  disabled={submitting}
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

          {/* New-adset flow */}
          {selectedStore && mode === "new" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Template adset (targeting + budget gets cloned)
                </label>
                {loadingAdsets ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 size={12} className="animate-spin" />
                    Loading adsets from scaling campaign…
                  </div>
                ) : adsets.length === 0 ? (
                  <div className="text-xs text-yellow-400 p-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                    No adsets yet. Create one manually in Ads Manager first
                    — the dashboard clones an existing one to save the
                    targeting/budget setup.
                  </div>
                ) : (
                  <select
                    value={templateAdsetId}
                    onChange={(e) => setTemplateAdsetId(e.target.value)}
                    disabled={submitting}
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
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  New adset name{" "}
                  <span className="text-gray-500">(min 3 chars)</span>
                </label>
                <input
                  type="text"
                  value={newAdsetName}
                  onChange={(e) => setNewAdsetName(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. ANGLE 24 — WINNER"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  The new adset will start PAUSED regardless of the setting
                  below. The ad itself respects the &quot;After copy&quot;
                  choice.
                </p>
              </div>
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
                disabled={submitting}
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
                disabled={submitting}
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

          {/* Error */}
          {error && (
            <div className="p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  {error}
                  {fbUserMsg && fbUserMsg !== error && (
                    <div className="text-[11px] text-red-200 mt-1">
                      {fbUserMsg}
                    </div>
                  )}
                  {(fbCode !== null || fbSubcode !== null || fbTrace) && (
                    <div className="text-[11px] text-red-400 mt-1 break-all">
                      {fbCode !== null && <span>FB code: {fbCode}</span>}
                      {fbSubcode !== null && (
                        <span> · subcode: {fbSubcode}</span>
                      )}
                      {fbTrace && <span> · trace: {fbTrace}</span>}
                    </div>
                  )}
                  {diag != null && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setShowDiag((v) => !v)}
                        className="text-[11px] text-red-200 underline cursor-pointer hover:text-white"
                      >
                        {showDiag ? "Hide" : "Show"} diagnostic
                      </button>
                      {showDiag && (
                        <div className="mt-2 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(
                                JSON.stringify(diag, null, 2)
                              );
                            }}
                            className="text-[11px] px-2 py-0.5 bg-red-900/40 border border-red-700/50 rounded hover:bg-red-900/60 cursor-pointer"
                          >
                            Copy JSON
                          </button>
                          <pre className="text-[10px] text-red-200/80 bg-black/40 border border-red-900/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(diag, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
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
            {submitting ? "Copying…" : "Promote to scaling"}
          </button>
        </div>
      </div>
    </div>
  );
}
