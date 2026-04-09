export interface ShopifyStore {
  id: string;
  name: string;
  store_url: string;
  api_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOrder {
  id: number;
  name: string; // "#1001"
  store_name: string;
  store_id: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null; // null = unfulfilled
  customer_name: string;
  province: string;
  age_days: number;
  age_level: "normal" | "warning" | "danger";
  line_items_count: number;
  tracking_number: string | null;
  is_cod: boolean;
  cancelled_at: string | null;
}

export type OrderDateFilter =
  | "today"
  | "yesterday"
  | "last_7d"
  | "this_month"
  | "last_30d"
  | "custom";

export type FulfillmentFilter =
  | "all"
  | "unfulfilled"
  | "fulfilled"
  | "partial"
  | "cancelled";

export interface OrdersSummary {
  total_orders: number;
  total_revenue: number;
  unfulfilled_count: number;
  fulfilled_count: number;
  cancelled_count: number;
  partially_fulfilled_count: number;
  avg_fulfillment_hours: number | null;
  cod_count: number;
  prepaid_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}
