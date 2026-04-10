// ============================================
// Facebook Ads Module — Single Ad Creator
// Creates: Campaign (optional) → Ad Set (optional) → Creative → Ad
// No framework dependencies — pass token directly
// ============================================

import { fbPost } from "./fb-api";
import type { CreateAdRequest, CreateAdResult, AdInput } from "./types";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Create a complete ad on Facebook Marketing API.
 *
 * Supports 3 modes:
 * - "new": Creates campaign + adset + creative + ad
 * - "existing_campaign": Creates adset + creative + ad under existing campaign
 * - "existing_adset": Creates creative + ad under existing adset
 *
 * @example
 * ```ts
 * const result = await createAd({
 *   ad_account_id: "act_123456",
 *   token: "your_fb_token",
 *   mode: "new",
 *   existing_campaign_id: null,
 *   existing_adset_id: null,
 *   campaign: { name: "My Campaign", objective: "OUTCOME_SALES", ... },
 *   adset: { name: "My Adset", daily_budget: 500, targeting: {...}, ... },
 *   ad: { name: "My Ad", page_id: "123", primary_text: "...", ... },
 *   status: "ACTIVE",
 * });
 * // result = { success: true, fb_campaign_id, fb_adset_id, fb_ad_id }
 * ```
 */
export async function createAd(req: CreateAdRequest): Promise<CreateAdResult> {
  const {
    ad_account_id,
    token,
    mode,
    existing_campaign_id,
    existing_adset_id,
    campaign,
    adset,
    ad,
    status = "ACTIVE",
  } = req;

  if (!ad_account_id) throw new Error("ad_account_id is required");
  if (!token) throw new Error("token is required");
  if (!ad.page_id) throw new Error("ad.page_id is required");

  let fbCampaignId: string | null = existing_campaign_id;
  let fbAdsetId: string | null = existing_adset_id;

  // Step 1: Create Campaign (if new)
  if (mode === "new" && campaign) {
    const params: Record<string, string> = {
      name: campaign.name,
      objective: campaign.objective,
      status,
      special_ad_categories: JSON.stringify(campaign.special_ad_categories),
    };

    if (campaign.campaign_budget_optimization) {
      params.bid_strategy = campaign.bid_strategy;
      if (campaign.daily_budget != null) {
        params.daily_budget = Math.round(campaign.daily_budget * 100).toString();
      }
      if (campaign.lifetime_budget != null) {
        params.lifetime_budget = Math.round(campaign.lifetime_budget * 100).toString();
      }
    } else {
      params.is_adset_budget_sharing_enabled = "false";
    }

    const result = await fbPost(`/${ad_account_id}/campaigns`, token, params);
    fbCampaignId = result.id as string;
  }

  if (!fbCampaignId) {
    throw new Error("No campaign ID — provide existing_campaign_id or campaign data");
  }

  // Step 2: Create Ad Set (if not using existing)
  if (mode !== "existing_adset" && adset) {
    const params: Record<string, string> = {
      name: adset.name,
      campaign_id: fbCampaignId,
      status,
      optimization_goal: adset.optimization_goal,
      billing_event: adset.billing_event,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: JSON.stringify(adset.targeting),
    };

    if (adset.daily_budget != null) {
      params.daily_budget = Math.round(adset.daily_budget * 100).toString();
    }
    if (adset.lifetime_budget != null) {
      params.lifetime_budget = Math.round(adset.lifetime_budget * 100).toString();
    }
    if (adset.start_time) params.start_time = adset.start_time;
    if (adset.end_time) params.end_time = adset.end_time;
    if (adset.optimization_goal === "OFFSITE_CONVERSIONS") {
      params.promoted_object = JSON.stringify(adset.promoted_object);
    }

    const result = await fbPost(`/${ad_account_id}/adsets`, token, params);
    fbAdsetId = result.id as string;
  }

  if (!fbAdsetId) {
    throw new Error("No ad set ID — provide existing_adset_id or adset data");
  }

  // Step 3: Create Ad Creative
  const creativeParams: Record<string, string> = {
    name: `Creative - ${ad.name}`,
  };

  const objectStorySpec = buildObjectStorySpec(ad, token);
  creativeParams.object_story_spec = JSON.stringify(objectStorySpec);

  if (ad.url_parameters) {
    creativeParams.url_tags = ad.url_parameters;
  }

  const creativeResult = await fbPost(
    `/${ad_account_id}/adcreatives`,
    token,
    creativeParams
  );
  const fbCreativeId = creativeResult.id as string;

  // Step 4: Create Ad
  const adParams: Record<string, string> = {
    name: ad.name,
    adset_id: fbAdsetId,
    creative: JSON.stringify({ creative_id: fbCreativeId }),
    status,
  };

  if (ad.url_parameters) {
    adParams.url_tags = ad.url_parameters;
  }

  const adResult = await fbPost(`/${ad_account_id}/ads`, token, adParams);

  return {
    success: true,
    fb_campaign_id: fbCampaignId,
    fb_adset_id: fbAdsetId,
    fb_ad_id: adResult.id as string,
  };
}

/**
 * Build the object_story_spec for ad creative.
 * Handles both image and video ads.
 */
function buildObjectStorySpec(
  ad: AdInput,
  token: string
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    page_id: ad.page_id,
  };

  if (ad.video_id) {
    const videoData: Record<string, unknown> = {
      video_id: ad.video_id,
      message: ad.primary_text,
      title: ad.headline,
      link_description: ad.description,
      call_to_action: {
        type: ad.call_to_action,
        value: { link: ad.website_url },
      },
    };

    if (ad.image_hash) {
      videoData.image_hash = ad.image_hash;
    } else {
      videoData.image_url = `${FB_API_BASE}/${ad.video_id}/picture?access_token=${token}`;
    }

    spec.video_data = videoData;
  } else {
    spec.link_data = {
      link: ad.website_url,
      message: ad.primary_text,
      name: ad.headline,
      description: ad.description,
      call_to_action: {
        type: ad.call_to_action,
        value: { link: ad.website_url },
      },
      image_hash: ad.image_hash || undefined,
    };
  }

  return spec;
}
