// Server-side helpers for the VA browser softphone.
// Token minting + budget check + config fetch.

import twilio from "twilio";
import { createServiceClient } from "@/lib/supabase/service";

interface VaDialerConfig {
  id: string;
  daily_budget_usd: number;
  recording_retention_days: number;
  enabled: boolean;
  recording_disclosure_text: string;
  per_call_max_seconds: number;
}

export async function getVaDialerConfig(): Promise<VaDialerConfig | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("va_dialer_config")
    .select("*")
    .eq("id", "default")
    .single();
  return (data as VaDialerConfig) ?? null;
}

export async function vaDialerHasBudget(): Promise<{
  ok: boolean;
  spend: number;
  cap: number;
}> {
  const sb = createServiceClient();
  const config = await getVaDialerConfig();
  if (!config) return { ok: false, spend: 0, cap: 0 };

  const today = phtToday();
  const { data: spendRow } = await sb
    .from("va_call_spend_daily")
    .select("total_cost_usd")
    .eq("date", today)
    .maybeSingle();

  const spend = Number(spendRow?.total_cost_usd ?? 0);
  return {
    ok: config.enabled && spend < Number(config.daily_budget_usd),
    spend,
    cap: Number(config.daily_budget_usd),
  };
}

export interface MintTokenInput {
  employeeId: string;
  ttlSeconds?: number;
}

export interface MintedToken {
  token: string;
  identity: string;
  expiresIn: number;
}

export function mintVoiceToken({
  employeeId,
  ttlSeconds = 3600,
}: MintTokenInput): MintedToken {
  const accountSid = required("TWILIO_ACCOUNT_SID");
  const apiKey = required("TWILIO_API_KEY");
  const apiSecret = required("TWILIO_API_SECRET");
  const appSid = required("TWILIO_VA_APP_SID");

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const identity = `va-${employeeId}`;
  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: ttlSeconds,
  });

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: appSid,
      incomingAllow: false,
    }),
  );

  return {
    token: token.toJwt(),
    identity,
    expiresIn: ttlSeconds,
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function phtToday(): string {
  const now = new Date();
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}
