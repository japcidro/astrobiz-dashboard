export interface CogsItem {
  id: string;
  store_name: string;
  sku: string;
  product_name: string | null;
  cogs_per_unit: number;
  created_at: string;
  updated_at: string;
}

export interface JtDelivery {
  id: string;
  waybill: string;
  order_status: string;
  classification: JtClassification;
  submission_date: string | null;
  signing_time: string | null;
  receiver: string | null;
  province: string | null;
  city: string | null;
  cod_amount: number;
  shipping_cost: number;
  item_name: string | null;
  num_items: number;
  item_value: number;
  store_name: string | null;
  payment_method: string | null;
  rts_reason: string | null;
  days_since_submit: number | null;
  tier_cutoff: number | null;
  is_delivered: boolean;
  is_returned: boolean;
  uploaded_at: string;
}

export type JtClassification =
  | "Delivered"
  | "Returned"
  | "For Return"
  | "Returned (Aged)"
  | "In Transit"
  | "Pending";

export interface DailyPnlRow {
  date: string;
  revenue: number;
  order_count: number;
  cogs: number;
  ad_spend: number;
  shipping: number;
  returns_value: number;
  net_profit: number;
  margin_pct: number;
  shipping_projected: boolean;
  returns_projected: boolean;
  in_transit_count: number;
}

export interface ProfitSummary {
  revenue: number;
  order_count: number;
  cogs: number;
  ad_spend: number;
  shipping: number;
  returns_value: number;
  net_profit: number;
  margin_pct: number;
}

export type ProfitDateFilter =
  | "today"
  | "yesterday"
  | "last_7d"
  | "this_month"
  | "last_month"
  | "last_30d"
  | "last_90d"
  | "custom";

export interface JtUploadResult {
  inserted: number;
  updated: number;
  total: number;
  protected_returns: number;
  errors: string[];
}
