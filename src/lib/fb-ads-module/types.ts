// ============================================
// Facebook Ads Module — Type Definitions
// Self-contained types for FB Marketing API
// ============================================

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

export type OptimizationGoal =
  | "OFFSITE_CONVERSIONS"
  | "LINK_CLICKS"
  | "LANDING_PAGE_VIEWS"
  | "IMPRESSIONS";

export type BillingEvent = "IMPRESSIONS" | "LINK_CLICKS";

export type CTAType =
  | "SHOP_NOW"
  | "LEARN_MORE"
  | "SIGN_UP"
  | "BOOK_NOW"
  | "CONTACT_US"
  | "GET_OFFER"
  | "ORDER_NOW";

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
  genders: number[];
  flexible_spec?: Array<{
    interests?: TargetingInterest[];
    behaviors?: TargetingInterest[];
  }>;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
}

export interface CampaignInput {
  name: string;
  objective: CampaignObjective;
  special_ad_categories: SpecialAdCategory[];
  campaign_budget_optimization: boolean;
  daily_budget: number | null;
  lifetime_budget: number | null;
  bid_strategy: BidStrategy;
}

export interface AdSetInput {
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

export interface AdInput {
  name: string;
  page_id: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  primary_text: string;
  headline: string;
  description: string;
  call_to_action: CTAType;
  website_url: string;
  url_parameters: string;
}

export interface CreateAdRequest {
  ad_account_id: string;
  token: string;
  mode: "new" | "existing_campaign" | "existing_adset";
  existing_campaign_id: string | null;
  existing_adset_id: string | null;
  campaign: CampaignInput | null;
  adset: AdSetInput | null;
  ad: AdInput;
  status?: "ACTIVE" | "PAUSED";
}

export interface CreateAdResult {
  success: true;
  fb_campaign_id: string;
  fb_adset_id: string;
  fb_ad_id: string;
}

export interface UploadResult {
  image_hash?: string;
  video_id?: string;
  file_name: string;
}

export interface BulkAdRow {
  id: string;
  adset_name: string;
  ad_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
  primary_text: string;
  headline: string;
  description: string;
}

export interface BulkCreateRequest {
  ad_account_id: string;
  token: string;
  mode: "new" | "existing_campaign";
  existing_campaign_id: string | null;
  campaign: CampaignInput | null;
  adset_template: AdSetInput;
  page_id: string;
  website_url: string;
  url_parameters: string;
  call_to_action: CTAType;
  rows: BulkAdRow[];
  status?: "ACTIVE" | "PAUSED";
  onProgress?: (index: number, total: number, rowId: string, result: "done" | "error", error?: string) => void;
}

export interface BulkCreateResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    row_id: string;
    success: boolean;
    fb_campaign_id?: string;
    fb_adset_id?: string;
    fb_ad_id?: string;
    error?: string;
  }>;
}
