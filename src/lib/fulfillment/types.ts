// ── Orders Queue ──
export interface UnfulfilledOrder {
  id: number;
  name: string; // "#1001"
  store_name: string;
  store_id: string;
  created_at: string;
  customer_name: string;
  line_items: OrderLineItem[];
  item_count: number;
  age_days: number;
}

export interface OrderLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  price: string;
  variant_id: number;
  product_id: number;
  fulfillment_status: string | null;
}

// ── Pick List ──
export interface PickListItem {
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  total_qty: number;
  picked_qty: number;
  bin_code: string | null;
  zone: string | null;
  orders: Array<{ order_name: string; qty: number }>;
}

// ── Pack & Verify ──
export interface VerifyItem {
  sku: string;
  barcode: string | null;
  title: string;
  variant_title: string | null;
  expected_qty: number;
  scanned_qty: number;
  status: "pending" | "matched" | "over";
}

export type VerifyStatus = "scanning" | "verified" | "mismatch";

export interface PackVerification {
  id: string;
  store_id: string;
  order_id: string;
  order_number: string;
  status: "verified" | "mismatch_corrected" | "failed";
  items_expected: number;
  items_scanned: number;
  mismatches: unknown;
  verified_by: string;
  started_at: string;
  completed_at: string;
}

// ── Inventory / Stock ──
export interface BinLocation {
  id: string;
  store_id: string;
  sku: string;
  variant_id: string | null;
  product_title: string | null;
  bin_code: string;
  zone: string | null;
  notes: string | null;
}

export interface InventoryAdjustment {
  id: string;
  store_id: string;
  sku: string;
  product_title: string | null;
  adjustment_type: "stock_in" | "manual_set" | "manual_adjust" | "cycle_count";
  previous_qty: number | null;
  new_qty: number | null;
  change_qty: number | null;
  reason: string | null;
  performed_by: string;
  created_at: string;
}

export interface StockRow {
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string | null;
  variant_id: number;
  inventory_item_id: number;
  stock: number;
  bin_code: string | null;
  zone: string | null;
  store_name: string;
  store_id: string;
}

export interface CycleCountEntry {
  sku: string;
  product_title: string;
  bin_code: string | null;
  expected_qty: number;
  actual_qty: number | null;
  diff: number | null;
  inventory_item_id: number;
}
