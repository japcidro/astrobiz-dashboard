"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  RefreshCw,
  Save,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

interface AvailableCampaign {
  id: string;
  name: string;
  account_id: string;
  account_name: string;
  status: string;
}

interface Mapping {
  store_name: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  updated_at?: string;
}

interface Props {
  storeNames: string[];
}

export function ScalingCampaignsManager({ storeNames }: Props) {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [campaigns, setCampaigns] = useState<AvailableCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Draft state: each store's selected campaign_id pending save.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, cRes] = await Promise.all([
        fetch("/api/marketing/scaling/config"),
        fetch("/api/marketing/scaling/campaigns-available"),
      ]);
      const mJson = await mRes.json();
      const cJson = await cRes.json();
      if (!mRes.ok) throw new Error(mJson.error || "Failed to load mappings");
      if (!cRes.ok)
        throw new Error(cJson.error || "Failed to load campaigns list");
      const rows = (mJson.rows as Mapping[]) ?? [];
      setMappings(rows);
      setCampaigns((cJson.campaigns as AvailableCampaign[]) ?? []);
      setDrafts(
        Object.fromEntries(rows.map((r) => [r.store_name, r.campaign_id]))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(storeName: string) {
    const campaignId = drafts[storeName];
    if (!campaignId) return;
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    setSaving(storeName);
    setError(null);
    try {
      const res = await fetch("/api/marketing/scaling/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          account_id: campaign.account_id,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSuccess(`Saved ${storeName} → ${campaign.name}`);
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function handleRemove(storeName: string) {
    if (
      !window.confirm(
        `Remove scaling-campaign mapping for "${storeName}"? The campaign itself stays on Facebook.`
      )
    ) {
      return;
    }
    setSaving(storeName);
    try {
      const res = await fetch(
        `/api/marketing/scaling/config?store=${encodeURIComponent(storeName)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Delete failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(null);
    }
  }

  const mappingMap = new Map(mappings.map((m) => [m.store_name, m]));

  return (
    <div className="max-w-3xl">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-600/20 rounded-lg">
              <TrendingUp size={20} className="text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Scaling Campaigns
              </h2>
              <p className="text-sm text-gray-400">
                Map each store to its scaling campaign. Used to flag ads
                already promoted and to add new winners to scaling.
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            title="Re-fetch campaigns from Facebook"
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-3 py-2 rounded-lg disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : storeNames.length === 0 ? (
          <p className="text-sm text-gray-500">
            No active Shopify stores yet. Add stores above first.
          </p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-yellow-300">
            No active campaigns returned from Facebook. Check your FB token
            + selected ad accounts.
          </p>
        ) : (
          <div className="space-y-3">
            {storeNames.map((store) => {
              const existing = mappingMap.get(store) ?? null;
              const draft = drafts[store] ?? "";
              const draftCampaign = campaigns.find((c) => c.id === draft);
              const isDirty =
                draft && draft !== (existing?.campaign_id ?? "");
              const isSaving = saving === store;
              return (
                <div
                  key={store}
                  className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white w-32 flex-shrink-0">
                      {store}
                    </span>
                    <select
                      value={draft}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [store]: e.target.value,
                        }))
                      }
                      disabled={isSaving}
                      className="flex-1 min-w-[260px] bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="">— No scaling campaign —</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.account_name} · {c.name}
                          {c.status === "PAUSED" ? " (paused)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleSave(store)}
                      disabled={!isDirty || isSaving}
                      className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isSaving ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      Save
                    </button>
                    {existing && (
                      <button
                        onClick={() => handleRemove(store)}
                        disabled={isSaving}
                        title="Remove mapping"
                        className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-2 py-2 rounded-lg cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  {existing && (
                    <p className="text-[11px] text-gray-500 mt-1.5 ml-[136px]">
                      Currently mapped to{" "}
                      <span className="text-gray-300">
                        {existing.campaign_name}
                      </span>
                    </p>
                  )}
                  {isDirty && draftCampaign && (
                    <p className="text-[11px] text-orange-400 mt-1.5 ml-[136px]">
                      Unsaved: will map to {draftCampaign.name} (
                      {draftCampaign.account_name})
                    </p>
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
