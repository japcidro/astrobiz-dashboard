export type AlertSeverity = "urgent" | "action" | "info";

export type AlertType =
  | "stock_restocked_winner"
  | "stock_depleting_winner"
  | "stock_added_by_team"
  | "new_winner"
  | "script_winner_deconstructed"
  | "autopilot_big_action"
  | "rts_spike"
  | "cash_at_risk"
  | "store_outage"
  | "ad_billing_threshold"
  | "ad_account_payment_failed"
  | "waybill_sender_mismatch"
  | "task_assigned"
  | "task_completed";

export type AlertResourceType =
  | "product"
  | "sku"
  | "ad"
  | "campaign"
  | "store"
  | "ad_account"
  | "autopilot_run"
  | "system"
  | "task";

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
  stock_added_by_team: "Stock added by team",
  new_winner: "New winner detected",
  script_winner_deconstructed: "Script winner deconstructed",
  autopilot_big_action: "Autopilot action",
  rts_spike: "RTS spike",
  cash_at_risk: "Cash at risk",
  store_outage: "Store connection failing",
  ad_billing_threshold: "Ad account near billing limit",
  ad_account_payment_failed: "Ad account payment failed",
  waybill_sender_mismatch: "Wrong sender on waybill",
  task_assigned: "Task assigned",
  task_completed: "Task completed",
};

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  urgent: 0,
  action: 1,
  info: 2,
};
