"use client";

import { useState, useEffect, useCallback, useReducer } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type {
  WizardMode,
  CampaignFormData,
  AdSetFormData,
  AdFormData,
} from "@/lib/facebook/types";
import { WizardNav } from "./wizard-nav";
import { StepModeSelect } from "./step-mode-select";
import { StepCampaign } from "./step-campaign";
import { StepAdset } from "./step-adset";
import { StepAd } from "./step-ad";
import { StepReview } from "./step-review";

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  status: string;
  is_active: boolean;
}

// Default form values
const defaultCampaign: CampaignFormData = {
  name: "",
  objective: "OUTCOME_SALES",
  special_ad_categories: [],
  campaign_budget_optimization: false,
  daily_budget: null,
  lifetime_budget: null,
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
};

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.toISOString().split("T")[0]}T00:00:00+08:00`;
}

const defaultAdSet: AdSetFormData = {
  name: "",
  daily_budget: 500,
  lifetime_budget: null,
  start_time: getTomorrowDate(),
  end_time: null,
  optimization_goal: "OFFSITE_CONVERSIONS",
  billing_event: "IMPRESSIONS",
  targeting: {
    geo_locations: { countries: ["PH"] },
    age_min: 18,
    age_max: 65,
    genders: [],
  },
  promoted_object: { pixel_id: "", custom_event_type: "PURCHASE" },
};

const defaultAd: AdFormData = {
  name: "",
  page_id: "",
  page_name: "",
  creative_type: "image",
  image_hash: null,
  video_id: null,
  file_name: null,
  file_preview_url: null,
  primary_text: "",
  headline: "",
  description: "",
  call_to_action: "SHOP_NOW",
  website_url: "",
  url_parameters: "utm_source=facebook&utm_medium=paid",
};

interface WizardState {
  mode: WizardMode;
  adAccountId: string;
  existingCampaignId: string | null;
  existingAdsetId: string | null;
  campaign: CampaignFormData;
  adset: AdSetFormData;
  ad: AdFormData;
  draftId: string | null;
}

type WizardAction =
  | { type: "SET_MODE"; payload: Partial<WizardState> }
  | { type: "SET_CAMPAIGN"; payload: Partial<CampaignFormData> }
  | { type: "SET_ADSET"; payload: Partial<AdSetFormData> }
  | { type: "SET_AD"; payload: Partial<AdFormData> }
  | { type: "SET_DRAFT_ID"; payload: string };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, ...action.payload };
    case "SET_CAMPAIGN":
      return { ...state, campaign: { ...state.campaign, ...action.payload } };
    case "SET_ADSET":
      return { ...state, adset: { ...state.adset, ...action.payload } };
    case "SET_AD":
      return { ...state, ad: { ...state.ad, ...action.payload } };
    case "SET_DRAFT_ID":
      return { ...state, draftId: action.payload };
    default:
      return state;
  }
}

export function AdCreateWizard() {
  const searchParams = useSearchParams();
  const draftParam = searchParams.get("draft");

  const [state, dispatch] = useReducer(wizardReducer, {
    mode: "new",
    adAccountId: "",
    existingCampaignId: null,
    existingAdsetId: null,
    campaign: defaultCampaign,
    adset: defaultAdSet,
    ad: defaultAd,
    draftId: null,
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch accounts on mount + load draft if ?draft= param exists
  useEffect(() => {
    const init = async () => {
      try {
        // Fetch accounts (cached 10 min)
        const { cachedFetch } = await import("@/lib/client-cache");
        const { data: accJson } = await cachedFetch<Record<string, unknown>>("/api/facebook/accounts", { ttl: 10 * 60 * 1000 });
        if (accJson.error) {
          setFetchError(accJson.error as string);
          return;
        }
        if (accJson.accounts) setAccounts(accJson.accounts as typeof accounts);

        // Load draft if param exists
        if (draftParam) {
          const draftRes = await fetch("/api/facebook/drafts");
          const draftJson = await draftRes.json();
          const draft = draftJson.data?.find(
            (d: { id: string }) => d.id === draftParam
          );
          if (draft) {
            dispatch({
              type: "SET_MODE",
              payload: {
                mode: draft.mode || "new",
                adAccountId: draft.ad_account_id || "",
                existingCampaignId: draft.existing_campaign_id || null,
                existingAdsetId: draft.existing_adset_id || null,
                campaign: draft.campaign_data || defaultCampaign,
                adset: draft.adset_data || defaultAdSet,
                ad: draft.ad_data || defaultAd,
                draftId: draft.id,
              },
            });
            // Reset failed status back to draft
            if (draft.status === "failed") {
              await fetch("/api/facebook/drafts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: draft.id,
                  status: "draft",
                  error_message: null,
                }),
              });
            }
          }
        }
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [draftParam]);

  // Determine which steps to show based on mode
  const steps = getSteps(state.mode);

  const saveDraft = useCallback(async () => {
    if (!state.adAccountId) return;
    setSaving(true);
    try {
      const draftPayload = {
        ...(state.draftId ? { id: state.draftId } : {}),
        ad_account_id: state.adAccountId,
        name: state.campaign.name || state.ad.name || "Untitled Draft",
        mode: state.mode,
        existing_campaign_id: state.existingCampaignId,
        existing_adset_id: state.existingAdsetId,
        campaign_data:
          state.mode === "new" ? state.campaign : null,
        adset_data:
          state.mode !== "existing_adset" ? state.adset : null,
        ad_data: state.ad,
      };

      const method = state.draftId ? "PUT" : "POST";
      const res = await fetch("/api/facebook/drafts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftPayload),
      });
      const json = await res.json();
      if (json.data?.id && !state.draftId) {
        dispatch({ type: "SET_DRAFT_ID", payload: json.data.id });
      }
    } finally {
      setSaving(false);
    }
  }, [state]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const canNext = (): boolean => {
    const step = steps[currentStep];
    switch (step) {
      case "mode":
        return !!state.adAccountId;
      case "campaign":
        return !!state.campaign.name && !!state.campaign.objective;
      case "adset":
        return !!state.adset.name;
      case "ad":
        return !!state.ad.name && !!state.ad.primary_text;
      case "review":
        return true;
      default:
        return true;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-6 text-center">
        <p className="text-red-300 font-medium mb-1">Failed to load accounts</p>
        <p className="text-red-400 text-sm">{fetchError}</p>
      </div>
    );
  }

  const stepContent = () => {
    const step = steps[currentStep];
    switch (step) {
      case "mode":
        return (
          <StepModeSelect
            mode={state.mode}
            adAccountId={state.adAccountId}
            existingCampaignId={state.existingCampaignId}
            existingAdsetId={state.existingAdsetId}
            accounts={accounts}
            onUpdate={(updates) =>
              dispatch({ type: "SET_MODE", payload: updates })
            }
          />
        );
      case "campaign":
        return (
          <StepCampaign
            data={state.campaign}
            onUpdate={(updates) =>
              dispatch({ type: "SET_CAMPAIGN", payload: updates })
            }
          />
        );
      case "adset":
        return (
          <StepAdset
            data={state.adset}
            adAccountId={state.adAccountId}
            pageName={state.ad.page_name}
            onUpdate={(updates) =>
              dispatch({ type: "SET_ADSET", payload: updates })
            }
          />
        );
      case "ad":
        return (
          <StepAd
            data={state.ad}
            adAccountId={state.adAccountId}
            onUpdate={(updates) =>
              dispatch({ type: "SET_AD", payload: updates })
            }
          />
        );
      case "review":
        return (
          <StepReview
            mode={state.mode}
            adAccountId={state.adAccountId}
            existingCampaignId={state.existingCampaignId}
            existingAdsetId={state.existingAdsetId}
            campaign={state.campaign}
            adset={state.adset}
            ad={state.ad}
            draftId={state.draftId}
            onGoToStep={setCurrentStep}
            onSubmitted={() => {}}
            onSaveDraft={saveDraft}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/marketing/ads"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-white">Create Ad</h1>
      </div>

      {/* Clickable step progress bar */}
      <div className="flex items-center gap-1 mb-6">
        {steps.map((step, i) => {
          const isActive = i === currentStep;
          const isCompleted = i < currentStep;
          const isClickable = i !== currentStep;
          return (
            <button
              key={step}
              onClick={() => isClickable && setCurrentStep(i)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2 px-1 rounded-lg transition-all ${
                isClickable ? "cursor-pointer hover:bg-gray-700/30" : "cursor-default"
              }`}
            >
              <div className="w-full flex items-center gap-1">
                <div
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    isCompleted
                      ? "bg-white"
                      : isActive
                        ? "bg-white"
                        : "bg-gray-700"
                  }`}
                />
              </div>
              <span
                className={`text-[11px] font-medium transition-colors ${
                  isActive
                    ? "text-white"
                    : isCompleted
                      ? "text-gray-400"
                      : "text-gray-600"
                }`}
              >
                {getStepLabel(step)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-6">
        {stepContent()}

        <WizardNav
          currentStep={currentStep}
          totalSteps={steps.length}
          onBack={handleBack}
          onNext={handleNext}
          onSaveDraft={saveDraft}
          saving={saving}
          canNext={canNext()}
        />
      </div>
    </div>
  );
}

type StepId = "mode" | "campaign" | "adset" | "ad" | "review";

function getSteps(mode: WizardMode): StepId[] {
  switch (mode) {
    case "new":
      return ["mode", "campaign", "adset", "ad", "review"];
    case "existing_campaign":
      return ["mode", "adset", "ad", "review"];
    case "existing_adset":
      return ["mode", "ad", "review"];
  }
}

function getStepLabel(step: StepId): string {
  switch (step) {
    case "mode":
      return "Setup";
    case "campaign":
      return "Campaign";
    case "adset":
      return "Ad Set";
    case "ad":
      return "Ad Creative";
    case "review":
      return "Review";
  }
}
