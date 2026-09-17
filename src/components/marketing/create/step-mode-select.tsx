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
  effective_status: string;
}

interface AdsetInfo {
  id: string;
  name: string;
  status: string;
  effective_status: string;
}

// Paused is a normal thing to add an ad to, but you should know before you do.
function statusSuffix(effectiveStatus: string): string {
  if (effectiveStatus === "ACTIVE") return "";
  return ` — ${effectiveStatus.replace(/_/g, " ").toLowerCase()}`;
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
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [adsetsError, setAdsetsError] = useState<string | null>(null);

  // Auto-select first active account if none selected
  useEffect(() => {
    const firstActive = accounts.find((a) => a.is_active);
    if (!adAccountId && firstActive) {
      onUpdate({ adAccountId: firstActive.id });
    }
  }, [accounts, adAccountId, onUpdate]);

  // Campaigns come from the campaigns edge, not from ad insights. A campaign
  // that hasn't spent yet is still a campaign you can add an ad to.
  useEffect(() => {
    if (!adAccountId || mode === "new") return;
    let cancelled = false;
    setLoadingCampaigns(true);
    setCampaignsError(null);
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch<Record<string, unknown>>(
        `/api/facebook/create/campaigns?account_id=${adAccountId}`,
        { ttl: 5 * 60 * 1000 }
      )
        .then(({ data: json }) => {
          if (cancelled) return;
          if (json.error) {
            setCampaignsError(json.error as string);
            setCampaigns([]);
            return;
          }
          setCampaigns((json.data as CampaignInfo[]) ?? []);
        })
        .catch((e: Error) => {
          if (!cancelled) setCampaignsError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoadingCampaigns(false);
        })
    );
    return () => {
      cancelled = true;
    };
  }, [adAccountId, mode]);

  // Ad sets load as soon as a campaign is picked. The previous guard waited
  // for mode === "existing_adset", which only happens once an ad set is
  // chosen — from a list that therefore never loaded. Nothing ever appeared
  // but "Create new ad set".
  useEffect(() => {
    if (!existingCampaignId || mode === "new") return;
    let cancelled = false;
    setLoadingAdsets(true);
    setAdsetsError(null);
    import("@/lib/client-cache").then(({ cachedFetch }) =>
      cachedFetch<Record<string, unknown>>(
        `/api/facebook/create/adsets?campaign_id=${existingCampaignId}`,
        { ttl: 5 * 60 * 1000 }
      )
        .then(({ data: json }) => {
          if (cancelled) return;
          if (json.error) {
            setAdsetsError(json.error as string);
            setAdsets([]);
            return;
          }
          setAdsets((json.data as AdsetInfo[]) ?? []);
        })
        .catch((e: Error) => {
          if (!cancelled) setAdsetsError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoadingAdsets(false);
        })
    );
    return () => {
      cancelled = true;
    };
  }, [existingCampaignId, mode]);

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
                <option value="">
                  {campaigns.length === 0
                    ? "No campaigns in this ad account"
                    : "Select campaign..."}
                </option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {statusSuffix(c.effective_status)}
                  </option>
                ))}
              </select>
            )}
            {campaignsError && (
              <p className="text-xs text-red-400 mt-1.5">{campaignsError}</p>
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
                      {statusSuffix(a.effective_status)}
                    </option>
                  ))}
                </select>
              )}
              {adsetsError ? (
                <p className="text-xs text-red-400 mt-1.5">{adsetsError}</p>
              ) : (
                !loadingAdsets &&
                adsets.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    This campaign has no ad sets yet — a new one will be created.
                  </p>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
