export type AlertSeverity = "urgent" | "action" | "info";

export type AlertType =
  | "stock_restocked_winner"
  | "stock_depleting_winner"
  | "new_winner"
  | "script_winner_deconstructed"
  | "autopilot_big_action"
  | "rts_spike"
  | "cash_at_risk"
  | "store_outage"
  | "waybill_sender_mismatch";

export type AlertResourceType =
  | "product"
  | "sku"
  | "ad"
  | "campaign"
  | "store"
  | "autopilot_run"
  | "system";

export interface AdminAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  resource_type: AlertResourceType | null;
  resource_id: string | null;
  action_url: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  acted_on_at: string | null;
  acted_by: string | null;
  emailed_at: string | null;
  digest_included_at: string | null;
}

export interface AlertInsertParams {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body?: string;
  resource_type?: AlertResourceType;
  resource_id?: string;
  action_url?: string;
  payload?: Record<string, unknown>;
  dedup_hours?: number;
}

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  stock_restocked_winner: "Winner restocked",
  stock_depleting_winner: "Winner running out",
  new_winner: "New winner detected",
  script_winner_deconstructed: "Script winner deconstructed",
  autopilot_big_action: "Autopilot action",
  rts_spike: "RTS spike",
  cash_at_risk: "Cash at risk",
  store_outage: "Store connection failing",
  waybill_sender_mismatch: "Wrong sender on waybill",
};

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  urgent: 0,
  action: 1,
  info: 2,
};
