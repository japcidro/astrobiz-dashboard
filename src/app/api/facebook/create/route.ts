import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type {
  WizardMode,
  CampaignFormData,
  AdSetFormData,
  AdFormData,
} from "@/lib/facebook/types";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

async function fbPost(
  endpoint: string,
  token: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  // Send as POST body (form-urlencoded) instead of query params
  // This avoids URL length limits for complex JSON params
  const res = await fetch(`${FB_API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, ...params }).toString(),
  });

  const text = await res.text();

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid FB response: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const fbErr = json.error as Record<string, unknown> | undefined;
    const msg = (fbErr?.error_user_msg as string)
      || (fbErr?.message as string)
      || `FB API error: ${res.status}`;
    const detail = fbErr?.error_user_title
      ? `${fbErr.error_user_title}: ${msg}`
      : msg;
    throw new Error(`${detail} [endpoint: ${endpoint}, code: ${fbErr?.code}, subcode: ${fbErr?.error_subcode}]`);
  }
  return json;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    draft_id,
    ad_account_id,
    mode,
    existing_campaign_id,
    existing_adset_id,
    campaign_data,
    adset_data,
    ad_data,
  } = body as {
    draft_id: string | null;
    ad_account_id: string;
    mode: WizardMode;
    existing_campaign_id: string | null;
    existing_adset_id: string | null;
    campaign_data: CampaignFormData | null;
    adset_data: AdSetFormData | null;
    ad_data: AdFormData;
  };

  if (!ad_account_id || !ad_data) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!ad_data.page_id) {
    return Response.json({ error: "No Facebook Page selected. Please go back to the Ad step and select a page." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json({ error: "Token not configured" }, { status: 400 });
  }

  const token = tokenSetting.value;

  // Update draft status to submitting
  if (draft_id) {
    await supabase
      .from("ad_drafts")
      .update({ status: "submitting", error_message: null })
      .eq("id", draft_id);
  }

  let fbCampaignId: string | null = existing_campaign_id;
  let fbAdsetId: string | null = existing_adset_id;
  let fbAdId: string | null = null;

  try {
    // Step 1: Create Campaign (if new)
    if (mode === "new" && campaign_data) {
      const campaignParams: Record<string, string> = {
        name: campaign_data.name,
        objective: campaign_data.objective,
        status: "ACTIVE",
        special_ad_categories: JSON.stringify(
          campaign_data.special_ad_categories
        ),
      };

      if (campaign_data.campaign_budget_optimization) {
        campaignParams.bid_strategy = campaign_data.bid_strategy;
        if (campaign_data.daily_budget != null) {
          campaignParams.daily_budget = Math.round(
            campaign_data.daily_budget * 100
          ).toString();
        }
        if (campaign_data.lifetime_budget != null) {
          campaignParams.lifetime_budget = Math.round(
            campaign_data.lifetime_budget * 100
          ).toString();
        }
      } else {
        // FB requires this when CBO is off
        campaignParams.is_adset_budget_sharing_enabled = "false";
      }

      const result = await fbPost(
        `/${ad_account_id}/campaigns`,
        token,
        campaignParams
      );
      fbCampaignId = result.id as string;
    }

    if (!fbCampaignId) {
      throw new Error("No campaign ID — select an existing campaign or create a new one");
    }

    // Step 2: Create Ad Set (if not using existing adset)
    if (mode !== "existing_adset" && adset_data) {
      // For OUTCOME_SALES, FB requires optimization_goal to match —
      // use OFFSITE_CONVERSIONS for purchase conversions
      const adsetParams: Record<string, string> = {
        name: adset_data.name,
        campaign_id: fbCampaignId,
        status: "ACTIVE",
        optimization_goal: adset_data.optimization_goal,
        billing_event: adset_data.billing_event,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: JSON.stringify(adset_data.targeting),
      };

      if (adset_data.daily_budget != null) {
        adsetParams.daily_budget = Math.round(
          adset_data.daily_budget * 100
        ).toString();
      }
      if (adset_data.lifetime_budget != null) {
        adsetParams.lifetime_budget = Math.round(
          adset_data.lifetime_budget * 100
        ).toString();
      }
      if (adset_data.start_time) {
        adsetParams.start_time = adset_data.start_time;
      }
      if (adset_data.end_time) {
        adsetParams.end_time = adset_data.end_time;
      }

      if (adset_data.optimization_goal === "OFFSITE_CONVERSIONS") {
        adsetParams.promoted_object = JSON.stringify(
          adset_data.promoted_object
        );
      }

      const result = await fbPost(
        `/${ad_account_id}/adsets`,
        token,
        adsetParams
      );
      fbAdsetId = result.id as string;
    }

    if (!fbAdsetId) {
      throw new Error("No ad set ID — select an existing ad set or create a new one");
    }

    // Step 3: Create Ad Creative
    const creativeParams: Record<string, string> = {
      name: `Creative - ${ad_data.name}`,
    };

    // Build object_story_spec — video uses video_data, image uses link_data
    const objectStorySpec: Record<string, unknown> = {
      page_id: ad_data.page_id,
    };

    if (ad_data.video_id) {
      // Fetch video thumbnail from FB (try picture, then thumbnails)
      let videoThumbnailUrl: string | undefined;
      try {
        const thumbRes = await fetch(
          `${FB_API_BASE}/${ad_data.video_id}?fields=picture,thumbnails&access_token=${token}`
        );
        const thumbJson = await thumbRes.json();

        // Try picture field first (most reliable)
        if (thumbJson?.picture) {
          videoThumbnailUrl = thumbJson.picture;
        }
        // Fallback to thumbnails
        if (!videoThumbnailUrl) {
          const thumbnails = thumbJson?.thumbnails?.data;
          if (thumbnails && thumbnails.length > 0) {
            const preferred = thumbnails.find((t: Record<string, unknown>) => t.is_preferred) || thumbnails[thumbnails.length - 1];
            videoThumbnailUrl = preferred.uri as string;
          }
        }
      } catch {
        // Thumbnail fetch failed — will use fallback
      }

      // If still no thumbnail, upload a blank thumbnail by using the video source frame
      // FB also accepts the video's own URL as image_url
      if (!videoThumbnailUrl) {
        videoThumbnailUrl = `https://graph.facebook.com/v21.0/${ad_data.video_id}/picture?access_token=${token}`;
      }

      // Video ad: use video_data
      const videoData: Record<string, unknown> = {
        video_id: ad_data.video_id,
        message: ad_data.primary_text,
        title: ad_data.headline,
        link_description: ad_data.description,
        call_to_action: {
          type: ad_data.call_to_action,
          value: {
            link: ad_data.website_url,
          },
        },
      };

      // Thumbnail: use image_hash if provided, otherwise use URL
      if (ad_data.image_hash) {
        videoData.image_hash = ad_data.image_hash;
      } else {
        videoData.image_url = videoThumbnailUrl;
      }

      objectStorySpec.video_data = videoData;
    } else {
      // Image ad: use link_data
      objectStorySpec.link_data = {
        link: ad_data.website_url,
        message: ad_data.primary_text,
        name: ad_data.headline,
        description: ad_data.description,
        call_to_action: {
          type: ad_data.call_to_action,
          value: {
            link: ad_data.website_url,
          },
        },
        image_hash: ad_data.image_hash || undefined,
      };
    }

    creativeParams.object_story_spec = JSON.stringify(objectStorySpec);

    if (ad_data.url_parameters) {
      creativeParams.url_tags = ad_data.url_parameters;
    }

    const creativeResult = await fbPost(
      `/${ad_account_id}/adcreatives`,
      token,
      creativeParams
    );
    const fbCreativeId = creativeResult.id as string;

    // Step 4: Create Ad
    const adParams: Record<string, string> = {
      name: ad_data.name,
      adset_id: fbAdsetId,
      creative: JSON.stringify({ creative_id: fbCreativeId }),
      status: "ACTIVE",
    };

    if (ad_data.url_parameters) {
      adParams.url_tags = ad_data.url_parameters;
    }

    const adResult = await fbPost(`/${ad_account_id}/ads`, token, adParams);
    fbAdId = adResult.id as string;

    // Update draft as submitted
    if (draft_id) {
      await supabase
        .from("ad_drafts")
        .update({
          status: "submitted",
          fb_campaign_id: fbCampaignId,
          fb_adset_id: fbAdsetId,
          fb_ad_id: fbAdId,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", draft_id);
    }

    return Response.json({
      success: true,
      fb_campaign_id: fbCampaignId,
      fb_adset_id: fbAdsetId,
      fb_ad_id: fbAdId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Submission failed";

    // Update draft as failed
    if (draft_id) {
      await supabase
        .from("ad_drafts")
        .update({
          status: "failed",
          error_message: message,
          fb_campaign_id: fbCampaignId,
          fb_adset_id: fbAdsetId,
          fb_ad_id: fbAdId,
        })
        .eq("id", draft_id);
    }

    return Response.json({
      error: message,
      debug: { page_id: ad_data.page_id, ad_account_id, mode },
    }, { status: 500 });
  }
}
