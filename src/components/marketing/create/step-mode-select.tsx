"use client";

import { useState, useEffect } from "react";
import { PlusCircle, FolderOpen, Loader2 } from "lucide-react";
import type { WizardMode } from "@/lib/facebook/types";

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  status: string;
  is_active: boolean;
}

interface CampaignInfo {
  id: string;
  name: string;
  status: string;
}

interface AdsetInfo {
  id: string;
  name: string;
  status: string;
}

interface StepModeSelectProps {
  mode: WizardMode;
  adAccountId: string;
  existingCampaignId: string | null;
  existingAdsetId: string | null;
  accounts: AccountInfo[];
  onUpdate: (updates: {
    mode?: WizardMode;
    adAccountId?: string;
    existingCampaignId?: string | null;
    existingAdsetId?: string | null;
  }) => void;
}

export function StepModeSelect({
  mode,
  adAccountId,
  existingCampaignId,
  existingAdsetId,
  accounts,
  onUpdate,
}: StepModeSelectProps) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [adsets, setAdsets] = useState<AdsetInfo[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets] = useState(false);

  // Auto-select first active account if none selected
  useEffect(() => {
    const firstActive = accounts.find((a) => a.is_active);
    if (!adAccountId && firstActive) {
      onUpdate({ adAccountId: firstActive.id });
    }
  }, [accounts, adAccountId, onUpdate]);

  // Fetch campaigns when account is selected and mode is existing
  useEffect(() => {
    if (!adAccountId || mode === "new") return;
    setLoadingCampaigns(true);
    import("@/lib/client-cache").then(({ cachedFetch }) =>
    cachedFetch<Record<string, unknown>>(`/api/facebook/all-ads?date_preset=last_30d&account=${adAccountId}`, { ttl: 10 * 60 * 1000 })
      .then(({ data: json }) => {
        if (json.data) {
          // Extract unique campaigns from ad data
          const campaignMap = new Map<string, CampaignInfo>();
          for (const row of json.data as Array<Record<string, string>>) {
            if (!campaignMap.has(row.campaign_id)) {
              campaignMap.set(row.campaign_id, {
                id: row.campaign_id,
                name: row.campaign,
                status: row.status,
              });
            }
          }
          setCampaigns(Array.from(campaignMap.values()));
        }
      })
      .finally(() => setLoadingCampaigns(false))
    );
  }, [adAccountId, mode]);

  // Fetch adsets when campaign is selected
  useEffect(() => {
    if (!existingCampaignId || mode !== "existing_adset") return;
    setLoadingAdsets(true);
    import("@/lib/client-cache").then(({ cachedFetch }) =>
    cachedFetch<Record<string, unknown>>(`/api/facebook/all-ads?date_preset=last_30d&account=${adAccountId}`, { ttl: 10 * 60 * 1000 })
      .then(({ data: json }) => {
        if (json.data) {
          const adsetMap = new Map<string, AdsetInfo>();
          for (const row of json.data as Array<Record<string, string>>) {
            if (
              row.campaign_id === existingCampaignId &&
              !adsetMap.has(row.adset_id)
            ) {
              adsetMap.set(row.adset_id, {
                id: row.adset_id,
                name: row.adset,
                status: row.status,
              });
            }
          }
          setAdsets(Array.from(adsetMap.values()));
        }
      })
      .finally(() => setLoadingAdsets(false))
    );
  }, [existingCampaignId, adAccountId, mode]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Create Facebook Ad
      </h2>
      <p className="text-gray-400 text-sm mb-6">
        Choose how you want to set up your ad.
      </p>

      {/* Account selector */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-1.5">Ad Account</label>
        <select
          value={adAccountId}
          onChange={(e) =>
            onUpdate({
              adAccountId: e.target.value,
              existingCampaignId: null,
              existingAdsetId: null,
            })
          }
          className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select account...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.is_active}>
              {a.name}{!a.is_active ? ` (${a.status})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <button
          onClick={() =>
            onUpdate({
              mode: "new",
              existingCampaignId: null,
              existingAdsetId: null,
            })
          }
          className={`p-5 rounded-xl border-2 text-left transition-all cursor-pointer ${
            mode === "new"
              ? "border-white bg-white/5"
              : "border-gray-700 hover:border-gray-600"
          }`}
        >
          <PlusCircle
            size={24}
            className={mode === "new" ? "text-white" : "text-gray-500"}
          />
          <h3
            className={`font-medium mt-3 ${mode === "new" ? "text-white" : "text-gray-300"}`}
          >
            Create New Campaign
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Full setup — campaign, ad set, targeting, and ad creative
          </p>
        </button>

        <button
          onClick={() =>
            onUpdate({
              mode: "existing_campaign",
              existingCampaignId: null,
              existingAdsetId: null,
            })
          }
          className={`p-5 rounded-xl border-2 text-left transition-all cursor-pointer ${
            mode !== "new"
              ? "border-white bg-white/5"
              : "border-gray-700 hover:border-gray-600"
          }`}
        >
          <FolderOpen
            size={24}
            className={mode !== "new" ? "text-white" : "text-gray-500"}
          />
          <h3
            className={`font-medium mt-3 ${mode !== "new" ? "text-white" : "text-gray-300"}`}
          >
            Add to Existing
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Add a new ad to an existing campaign or ad set
          </p>
        </button>
      </div>

      {/* Existing campaign/adset selection */}
      {mode !== "new" && (
        <div className="space-y-4 bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Select Campaign
            </label>
            {loadingCampaigns ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                <Loader2 size={14} className="animate-spin" />
                Loading campaigns...
              </div>
            ) : (
              <select
                value={existingCampaignId || ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  onUpdate({
                    existingCampaignId: val,
                    existingAdsetId: null,
                    mode: "existing_campaign",
                  });
                }}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {existingCampaignId && (
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                Select Ad Set{" "}
                <span className="text-gray-600">(or create new)</span>
              </label>
              {loadingAdsets ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                  <Loader2 size={14} className="animate-spin" />
                  Loading ad sets...
                </div>
              ) : (
                <select
                  value={existingAdsetId || ""}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    onUpdate({
                      existingAdsetId: val,
                      mode: val ? "existing_adset" : "existing_campaign",
                    });
                  }}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Create new ad set</option>
                  {adsets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
