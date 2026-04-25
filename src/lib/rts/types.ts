export type RtsBatchStatus = "open" | "closed";

export interface RtsBatch {
  id: string;
  batch_ref: string;
  store_id: string;
  notes: string | null;
  status: RtsBatchStatus;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  item_count: number;
  unit_count: number;
}

export interface RtsBatchListItem extends RtsBatch {
  store_name?: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
}

export interface RtsBatchScan {
  sku: string;
  product_title: string | null;
  count: number;
  last_scanned_at: string;
}

export interface RtsBatchDetail extends RtsBatchListItem {
  scans: RtsBatchScan[];
}
