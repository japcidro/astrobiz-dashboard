"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  CAMPAIGN_OBJECTIVES,
  serializeChoice,
  parseChoice,
  type CampaignChoice,
  type ConfiguredScalingCampaign,
  type NewCampaignDraft,
  type ScalingCampaignRef,
} from "@/lib/marketing/scaling-destination";

// Shared destination-campaign picker for both promote-to-scaling modals.
// The choice itself — its shape, its validation, and the request body it
// turns into — lives in lib/marketing/scaling-destination.ts; this file is
// the fetch and the form.

export function useScalingCampaigns(store: string) {
  const [campaigns, setCampaigns] = useState<ScalingCampaignRef[]>([]);
  const [configured, setConfigured] =
    useState<ConfiguredScalingCampaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    setCampaigns([]);
    setConfigured(null);
    try {
      const res = await fetch(
        `/api/marketing/scaling/campaigns?store=${encodeURIComponent(s)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load campaigns");
      setCampaigns((json.campaigns as ScalingCampaignRef[]) ?? []);
      setConfigured(
        (json.configured as ConfiguredScalingCampaign | null) ?? null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (store) load(store);
  }, [store, load]);

  return { campaigns, configured, loading, error };
}

// One import site for the modals: the picker plus everything they need to
// drive it.
export * from "@/lib/marketing/scaling-destination";

function statusTag(effective_status: string): string {
  return effective_status.includes("PAUSED") ? " (paused)" : "";
}

interface PickerProps {
  choice: CampaignChoice;
  onChoiceChange: (c: CampaignChoice) => void;
  draft: NewCampaignDraft;
  onDraftChange: (d: NewCampaignDraft) => void;
  campaigns: ScalingCampaignRef[];
  configured: ConfiguredScalingCampaign | null;
  loading: boolean;
  disabled?: boolean;
  // Only shown for a brand-new campaign, which has no ad sets of its own to
  // clone from: which existing campaign the template ad set comes from.
  templateCampaignId: string;
  onTemplateCampaignChange: (id: string) => void;
}

export function ScalingCampaignPicker({
  choice,
  onChoiceChange,
  draft,
  onDraftChange,
  campaigns,
  configured,
  loading,
  disabled = false,
  templateCampaignId,
  onTemplateCampaignChange,
}: PickerProps) {
  // Everything except the mapped campaign, which gets its own first option.
  const others = campaigns.filter((c) => c.id !== configured?.id);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          Target campaign
        </label>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
            <Loader2 size={12} className="animate-spin" />
            Loading campaigns in this ad account…
          </div>
        ) : (
          <select
            value={serializeChoice(choice)}
            onChange={(e) => onChoiceChange(parseChoice(e.target.value))}
            disabled={disabled}
            className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500 disabled:opacity-50"
          >
            <option value="configured">
              {configured
                ? `${configured.name} (scaling campaign)`
                : "Scaling campaign"}
            </option>
            {others.length > 0 && (
              <optgroup label="Other campaigns in this ad account">
                {others.map((c) => (
                  <option key={c.id} value={`existing:${c.id}`}>
                    {c.name}
                    {statusTag(c.effective_status)}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="new">+ Create a new campaign…</option>
          </select>
        )}
      </div>

      {choice.kind === "new" && (
        <div className="space-y-3 p-3 bg-gray-800/40 border border-gray-700/50 rounded-lg">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              New campaign name
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) =>
                onDraftChange({ ...draft, name: e.target.value })
              }
              disabled={disabled}
              placeholder="e.g. CBO — SEPT WINNERS"
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1.5">
                Objective
              </label>
              <select
                value={draft.objective}
                onChange={(e) =>
                  onDraftChange({ ...draft, objective: e.target.value })
                }
                disabled={disabled}
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">— Pick objective —</option>
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1.5">
                Daily budget (CBO){" "}
                <span className="text-gray-600">optional</span>
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={draft.daily_budget}
                onChange={(e) =>
                  onDraftChange({ ...draft, daily_budget: e.target.value })
                }
                disabled={disabled}
                placeholder="e.g. 2000"
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            The objective must match the ad set you clone below, or Meta
            refuses the clone — it is pre-filled from the scaling campaign.
            Leave the budget blank to keep budgets at the ad set level; set
            it and the campaign runs on CBO, which Meta will not accept if
            the ad set you clone carries its own budget.
          </p>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Clone the first ad set from
            </label>
            <select
              value={templateCampaignId}
              onChange={(e) => onTemplateCampaignChange(e.target.value)}
              disabled={disabled}
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-orange-500 focus:border-orange-500"
            >
              {configured && (
                <option value={configured.id}>
                  {configured.name} (scaling campaign)
                </option>
              )}
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {statusTag(c.effective_status)}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              A new campaign has no ad sets, and Meta cannot make a blank
              one — it is always a copy. Pick the campaign whose ad sets the
              new one should be modelled on.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
