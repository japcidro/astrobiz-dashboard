export interface FBCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  insights?: FBInsights;
}

export interface FBAdSet {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name?: string;
  targeting_summary?: string;
  insights?: FBInsights;
}

export interface FBAd {
  id: string;
  name: string;
  status: string;
  adset_id: string;
  adset_name?: string;
  insights?: FBInsights;
}

export interface FBInsights {
  spend: number;
  reach: number;
  impressions: number;
  results: number;
  cpa: number;
  roas: number;
  add_to_cart: number;
  purchases: number;
}

export interface FBApiResponse<T> {
  data: T[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "this_month"
  | "last_month";

export type DrillLevel = "campaign" | "adset" | "ad";

// ─── Ad Creation Types ───

export type CampaignObjective =
  | "OUTCOME_SALES"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS";

export type BidStrategy =
  | "LOWEST_COST_WITHOUT_CAP"
  | "COST_CAP"
  | "BID_CAP";

export type SpecialAdCategory =
  | "HOUSING"
  | "CREDIT"
  | "EMPLOYMENT"
  | "ISSUES_ELECTIONS_POLITICS";

export interface CampaignFormData {
  name: string;
  objective: CampaignObjective;
  special_ad_categories: SpecialAdCategory[];
  campaign_budget_optimization: boolean;
  daily_budget: number | null;
  lifetime_budget: number | null;
  bid_strategy: BidStrategy;
}

export type OptimizationGoal =
  | "OFFSITE_CONVERSIONS"
  | "LINK_CLICKS"
  | "LANDING_PAGE_VIEWS"
  | "IMPRESSIONS";

export type BillingEvent = "IMPRESSIONS" | "LINK_CLICKS";

export interface TargetingInterest {
  id: string;
  name: string;
}

export interface TargetingSpec {
  geo_locations: {
    countries: string[];
    cities?: Array<{ key: string; name: string; region: string }>;
  };
  age_min: number;
  age_max: number;
  genders: number[]; // 0=all, 1=male, 2=female
  flexible_spec?: Array<{
    interests?: TargetingInterest[];
    behaviors?: TargetingInterest[];
  }>;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
}

export interface AdSetFormData {
  name: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  start_time: string;
  end_time: string | null;
  optimization_goal: OptimizationGoal;
  billing_event: BillingEvent;
  targeting: TargetingSpec;
  promoted_object: {
    pixel_id: string;
    custom_event_type: string;
  };
}

export type CTAType =
  | "SHOP_NOW"
  | "LEARN_MORE"
  | "SIGN_UP"
  | "BOOK_NOW"
  | "CONTACT_US"
  | "GET_OFFER"
  | "ORDER_NOW";

export interface AdFormData {
  name: string;
  page_id: string;
  page_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
  file_preview_url: string | null;
  primary_text: string;
  headline: string;
  description: string;
  call_to_action: CTAType;
  website_url: string;
  url_parameters: string;
}

export type DraftStatus = "draft" | "submitting" | "submitted" | "failed";

export type WizardMode = "new" | "existing_campaign" | "existing_adset";

export interface AdDraft {
  id: string;
  employee_id: string;
  ad_account_id: string;
  status: DraftStatus;
  name: string;
  mode: WizardMode;
  existing_campaign_id: string | null;
  existing_adset_id: string | null;
  campaign_data: CampaignFormData | null;
  adset_data: AdSetFormData | null;
  ad_data: AdFormData;
  fb_campaign_id: string | null;
  fb_adset_id: string | null;
  fb_ad_id: string | null;
  error_message: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}
