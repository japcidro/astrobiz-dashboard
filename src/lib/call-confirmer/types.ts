export type CallConfirmerLanguage = "taglish" | "tagalog" | "english";

export type CallStatus =
  | "queued"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "voicemail"
  | "busy"
  | "escalated";

export type CallOutcome =
  | "confirmed"
  | "declined"
  | "needs_callback"
  | "escalated_to_human"
  | "unreachable"
  | "invalid_number";

export type CallSentiment = "positive" | "neutral" | "negative";

export interface CallConfirmerConfig {
  id: string;
  store_id: string;
  enabled: boolean;
  agent_name: string;
  voice_id: string | null;
  language: CallConfirmerLanguage;
  greeting_template: string | null;
  business_hours_start: string;
  business_hours_end: string;
  max_attempts: number;
  retry_interval_minutes: number;
  support_phone: string | null;
  daily_budget_usd: number;
  per_call_max_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface CallAttempt {
  id: string;
  store_id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  customer_name: string | null;
  customer_phone: string;
  order_snapshot: Record<string, unknown> | null;
  attempt_number: number;
  is_test_call: boolean;
  initiated_by: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  provider: string;
  provider_call_id: string | null;
  duration_seconds: number | null;
  cost_usd: number | null;
  recording_url: string | null;
  transcript: TranscriptTurn[] | null;
  ai_summary: string | null;
  questions_asked: string[] | null;
  customer_sentiment: CallSentiment | null;
  handoff_reason: string | null;
  needs_va_followup: boolean;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface TranscriptTurn {
  role: "assistant" | "user";
  message: string;
  timestamp?: string;
}

export interface CallSpendDaily {
  store_id: string;
  date: string;
  total_calls: number;
  total_seconds: number;
  total_cost_usd: number;
  test_calls: number;
  test_cost_usd: number;
}

export interface ShopifyStoreLite {
  id: string;
  name: string;
}

export const DEFAULT_GREETING_TEMPLATE =
  "Hello po Sir/Ma'am {customer_name}, si {agent_name} po ito from {store_name}. " +
  "Tinawagan po kita para i-confirm ang order ninyo. May time po ba kayo?";
