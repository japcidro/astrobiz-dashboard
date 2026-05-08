export type KpiScope = "individual" | "team" | "watch";
export type KpiSegment = "marketing" | "sales_va" | "fulfillment" | "watch";
export type KpiDirection = "higher_better" | "lower_better";
export type KpiStatus = "green" | "yellow" | "red";

export interface KpiTarget {
  id: string;
  kpi_key: string;
  scope: KpiScope;
  segment: KpiSegment;
  display_name: string;
  unit: string | null;
  direction: KpiDirection;
  red_threshold: number;
  green_threshold: number;
  effective_from: string;
  is_active: boolean;
}

export interface KpiSnapshot {
  id: string;
  snapshot_date: string;
  kpi_key: string;
  scope: KpiScope;
  employee_id: string | null;
  value: number;
  status: KpiStatus;
  raw_data: Record<string, unknown> | null;
  computed_at: string;
}

export interface KpiTileData {
  kpi_key: string;
  display_name: string;
  segment: KpiSegment;
  scope: KpiScope;
  unit: string | null;
  direction: KpiDirection;
  red_threshold: number;
  green_threshold: number;
  value: number | null;
  status: KpiStatus | null;
  employee_id: string | null;
  employee_name: string | null;
  raw_data: Record<string, unknown> | null;
  snapshot_date: string | null;
}
