"use client";

import { useState } from "react";
import {
  CheckCircle,
  Loader2,
  AlertCircle,
  Pencil,
  Image,
  Film,
} from "lucide-react";
import type {
  WizardMode,
  CampaignFormData,
  AdSetFormData,
  AdFormData,
} from "@/lib/facebook/types";

interface StepReviewProps {
  mode: WizardMode;
  adAccountId: string;
  existingCampaignId: string | null;
  existingAdsetId: string | null;
  campaign: CampaignFormData;
  adset: AdSetFormData;
  ad: AdFormData;
  draftId: string | null;
  onGoToStep: (step: number) => void;
  onSubmitted: (result: {
    fb_campaign_id: string;
    fb_adset_id: string;
    fb_ad_id: string;
  }) => void;
  onSaveDraft: () => Promise<void>;
}

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Sales",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_LEADS: "Leads",
};

const GOAL_LABELS: Record<string, string> = {
  OFFSITE_CONVERSIONS: "Conversions",
  LINK_CLICKS: "Link Clicks",
  LANDING_PAGE_VIEWS: "Landing Page Views",
  IMPRESSIONS: "Impressions",
};

const CTA_LABELS: Record<string, string> = {
  SHOP_NOW: "Shop Now",
  LEARN_MORE: "Learn More",
  ORDER_NOW: "Order Now",
  GET_OFFER: "Get Offer",
  SIGN_UP: "Sign Up",
  BOOK_NOW: "Book Now",
  CONTACT_US: "Contact Us",
};

export function StepReview({
  mode,
  adAccountId,
  existingCampaignId,
  existingAdsetId,
  campaign,
  adset,
  ad,
  draftId,
  onGoToStep,
  onSubmitted,
  onSaveDraft,
}: StepReviewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    fb_campaign_id: string;
    fb_adset_id: string;
    fb_ad_id: string;
  } | null>(null);

  const fmt = (n: number) =>
    `₱${n.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // Determine step indices based on mode
  const getStepIndex = (step: "campaign" | "adset" | "ad") => {
    if (mode === "new") {
      return { campaign: 1, adset: 2, ad: 3 }[step];
    }
    if (mode === "existing_campaign") {
      return { campaign: -1, adset: 1, ad: 2 }[step];
    }
    // existing_adset
    return { campaign: -1, adset: -1, ad: 1 }[step];
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    // Save draft first to get a draft ID
    if (!draftId) {
      setProgress("Saving draft...");
      await onSaveDraft();
    }

    setProgress("Submitting to Facebook...");

    try {
      const res = await fetch("/api/facebook/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: draftId,
          ad_account_id: adAccountId,
          mode,
          existing_campaign_id: existingCampaignId,
          existing_adset_id: existingAdsetId,
          campaign_data: mode === "new" ? campaign : null,
          adset_data: mode !== "existing_adset" ? adset : null,
          ad_data: ad,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        const debugInfo = json.debug ? ` | page_id: ${json.debug.page_id}, account: ${json.debug.ad_account_id}` : "";
        throw new Error(`${json.error}${debugInfo}`);
      }

      setSuccess({
        fb_campaign_id: json.fb_campaign_id,
        fb_adset_id: json.fb_adset_id,
        fb_ad_id: json.fb_ad_id,
      });
      onSubmitted(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  // Success state
  if (success) {
    return (
      <div className="text-center py-10">
        <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">
          Ad Created Successfully!
        </h2>
        <p className="text-gray-400 text-sm mb-6">
          Your ad has been created and is <strong>ACTIVE</strong>. It will start
          running on the scheduled date.
        </p>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 max-w-sm mx-auto mb-6 text-left">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Campaign</span>
              <span className="text-gray-500 text-xs font-mono">
                {success.fb_campaign_id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Ad Set</span>
              <span className="text-gray-500 text-xs font-mono">
                {success.fb_adset_id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Ad</span>
              <span className="text-gray-500 text-xs font-mono">
                {success.fb_ad_id}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <a
            href="/marketing/ads"
            className="bg-white text-gray-900 text-sm font-medium px-5 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Go to Ad Performance
          </a>
          <a
            href="/marketing/create"
            className="bg-gray-700 text-white text-sm px-5 py-2 rounded-lg hover:bg-gray-600 transition-colors"
          >
            Create Another
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          Review & Submit
        </h2>
        <p className="text-gray-400 text-sm">
          Review your ad settings before submitting. All ads are created as{" "}
          <strong className="text-green-400">ACTIVE</strong> — ads will start
          running on their scheduled date.
        </p>
      </div>

      {/* Campaign Summary */}
      {mode === "new" && (
        <SummaryCard
          title="Campaign"
          onEdit={() => onGoToStep(getStepIndex("campaign"))}
        >
          <SummaryRow label="Name" value={campaign.name} />
          <SummaryRow
            label="Objective"
            value={OBJECTIVE_LABELS[campaign.objective] || campaign.objective}
          />
          <SummaryRow
            label="Budget Optimization"
            value={campaign.campaign_budget_optimization ? "On (CBO)" : "Off"}
          />
          {campaign.campaign_budget_optimization && (
            <SummaryRow
              label="Budget"
              value={
                campaign.daily_budget != null
                  ? `${fmt(campaign.daily_budget)}/day`
                  : campaign.lifetime_budget != null
                    ? `${fmt(campaign.lifetime_budget)} lifetime`
                    : "—"
              }
            />
          )}
        </SummaryCard>
      )}

      {mode !== "new" && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-2">Campaign</h3>
          <p className="text-sm text-gray-400">
            Using existing campaign{" "}
            <span className="text-gray-300 font-mono text-xs">
              {existingCampaignId}
            </span>
          </p>
        </div>
      )}

      {/* Ad Set Summary */}
      {mode !== "existing_adset" && (
        <SummaryCard
          title="Ad Set"
          onEdit={() => onGoToStep(getStepIndex("adset"))}
        >
          <SummaryRow label="Name" value={adset.name} />
          <SummaryRow
            label="Budget"
            value={
              adset.daily_budget != null
                ? `${fmt(adset.daily_budget)}/day`
                : adset.lifetime_budget != null
                  ? `${fmt(adset.lifetime_budget)} lifetime`
                  : "—"
            }
          />
          <SummaryRow
            label="Schedule"
            value={
              adset.start_time
                ? `${adset.start_time.split("T")[0]}${adset.end_time ? ` — ${adset.end_time.split("T")[0]}` : " onwards"}`
                : "Start immediately"
            }
          />
          <SummaryRow
            label="Age"
            value={`${adset.targeting.age_min} - ${adset.targeting.age_max === 65 ? "65+" : adset.targeting.age_max}`}
          />
          <SummaryRow
            label="Gender"
            value={
              adset.targeting.genders.length === 0
                ? "All"
                : adset.targeting.genders.includes(1)
                  ? "Men"
                  : "Women"
            }
          />
          <SummaryRow
            label="Interests"
            value={
              adset.targeting.flexible_spec?.[0]?.interests
                ?.map((i) => i.name)
                .join(", ") || "None"
            }
          />
          <SummaryRow
            label="Optimization"
            value={
              GOAL_LABELS[adset.optimization_goal] || adset.optimization_goal
            }
          />
        </SummaryCard>
      )}

      {mode === "existing_adset" && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-2">Ad Set</h3>
          <p className="text-sm text-gray-400">
            Using existing ad set{" "}
            <span className="text-gray-300 font-mono text-xs">
              {existingAdsetId}
            </span>
          </p>
        </div>
      )}

      {/* Ad Summary */}
      <SummaryCard
        title="Ad Creative"
        onEdit={() => onGoToStep(getStepIndex("ad"))}
      >
        <SummaryRow label="Name" value={ad.name} />
        <SummaryRow
          label="Creative"
          value={
            <span className="inline-flex items-center gap-1.5">
              {ad.creative_type === "image" ? (
                <Image size={12} />
              ) : (
                <Film size={12} />
              )}
              {ad.file_name || "Not uploaded"}
            </span>
          }
        />
        <SummaryRow label="Primary Text" value={ad.primary_text || "—"} />
        <SummaryRow label="Headline" value={ad.headline || "—"} />
        <SummaryRow
          label="CTA"
          value={CTA_LABELS[ad.call_to_action] || ad.call_to_action}
        />
        <SummaryRow label="URL" value={ad.website_url || "—"} />
      </SummaryCard>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle
            size={18}
            className="text-red-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-red-300 text-sm font-medium">
              Submission Failed
            </p>
            <p className="text-red-400 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Submit button */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-white text-gray-900 text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {progress}
            </>
          ) : (
            "Submit to Facebook"
          )}
        </button>
        <p className="text-xs text-gray-500">
          Ad will be created as ACTIVE
        </p>
      </div>
    </div>
  );
}

// --- Helper components ---

function SummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <button
          onClick={onEdit}
          className="text-gray-500 hover:text-white text-xs flex items-center gap-1 cursor-pointer transition-colors"
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 text-right max-w-[60%] break-words">
        {value}
      </span>
    </div>
  );
}
