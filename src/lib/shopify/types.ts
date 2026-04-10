export interface ShopifyStore {
  id: string;
  name: string;
  store_url: string;
  api_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOrderLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: string;
  sku: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string; // "#1001"
  store_name: string;
  store_id: string;
  created_at: string;
  total_price: string;
  subtotal_price: string;
  shipping_price: string;
  total_tax: string;
  total_discounts: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null; // null = unfulfilled
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_orders_count: number;
  customer_total_spent: string;
  shipping_address: string | null; // full formatted address
  province: string;
  age_days: number;
  age_level: "normal" | "warning" | "danger";
  line_items: ShopifyOrderLineItem[];
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company: string | null;
  fulfilled_at: string | null;
  is_cod: boolean;
  cancelled_at: string | null;
  gateway: string;
  note: string | null;
  tags: string;
  discount_codes: { code: string; amount: string; type: string }[];
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
