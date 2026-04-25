export type BriefingType = "morning" | "evening" | "weekly" | "monthly";

export interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
  dateFilter: string;
  datePreset: string;
}

export interface StoreBreakdown {
  store_name: string;
  revenue: number;
  orders: number;
  unfulfilled: number;
}

export interface TopProduct {
  sku: string | null;
  product_title: string;
  store_name: string;
  units_sold: number;
  revenue: number;
}

export interface TopAd {
  ad_id: string;
  ad_name: string;
  spend: number;
  roas: number;
  purchases: number;
  cpa: number;
}

export interface AutopilotSummary {
  paused: number;
  resumed: number;
  total_spend_affected: number;
}

export interface TeamHours {
  role: string;
  hours: number;
}

export interface RtsSummary {
  rts_count: number;
  rts_value: number;
  top_province: string | null;
}

export interface StockMovement {
  product_title: string;
  store_name: string;
  delta: number;       // negative = sold down, positive = restocked
  stock_now: number;
}

export interface BriefingData {
  // P&L
  revenue: number;
  orders: number;
  ad_spend: number;
  net_profit_est: number;
  roas: number;
  cpa: number;

  // Comparison period
  revenue_delta_pct: number | null;
  profit_delta_pct: number | null;

  // Operations
  unfulfilled_count: number;
  aging_count: number;
  fulfilled_count: number;

  // Lists
  top_products: TopProduct[];
  top_ads: TopAd[];
  worst_ads: TopAd[];
  store_breakdown: StoreBreakdown[];
  autopilot: AutopilotSummary;
  rts: RtsSummary;
  stock_movement: StockMovement[];
  team_hours: TeamHours[];
}

// Which upstream a safeFetch call was hitting when it returned null.
// Used to decide if a briefing's zeros are real or a fetch failure.
export type FetchSource = "pnl" | "ads" | "orders" | "prev_pnl";

export interface FetchError {
  source: FetchSource;
  message: string;
}

export interface Briefing {
  id: string;
  type: BriefingType;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  headline: string;
  ai_summary: string | null;
  data: BriefingData;
  email_sent_at: string | null;
  email_recipients: number | null;
  email_id: string | null;
  email_error: string | null;
  fetch_errors: FetchError[];
  retry_count: number;
  last_retry_at: string | null;
  created_at: string;
}
